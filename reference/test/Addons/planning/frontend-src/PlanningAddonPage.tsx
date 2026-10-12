import {useEffect,useMemo,useState,type FormEvent} from 'react';
import css from './planning.css?inline';
import {planningService} from '../../../frontend-next/src/modules/planning/services/planningService';
import {previewBlockPlan,type BlockImportPreview} from '../../../frontend-next/src/modules/planning/services/blockImportPreview';
import {entryState,partitionEntries} from '../../../frontend-next/src/modules/planning/services/planningTimeline';
import {loadRuntimeConfig} from '../../../frontend-next/src/shared/services/runtimeConfig';
import {errorMessage} from '../../../frontend-next/src/shared/services/apiClient';
import type {PlanningPlan,PlanningPerson,PlanningPracticum,PlanningBlockPlan,PlanningEntry,RuntimeConfig}
  from '../../../frontend-next/src/shared/types';

type Panel='plans'|'blocks'|'practicums';
type Modal='plan'|'block'|'practicum'|'entry'|null;
type Draft={
  name:string;group_names:string[];training_years:number[];exclude_blind:boolean;
  persons_per_turn:number;slot_priorities:Record<string,string>;
  interval_value:number;interval_unit:string;start_date:string;end_date:string;
  block_plan_id:string;consider_school:boolean;consider_practicum:boolean;weekdays_only:boolean
};
const blank=():Draft=>({
  name:'',group_names:[],training_years:[1,2,3],exclude_blind:false,
  persons_per_turn:2,slot_priorities:{'1':'primary','2':'secondary'},
  interval_value:1,interval_unit:'week',start_date:'',end_date:'',
  block_plan_id:'',consider_school:true,consider_practicum:true,weekdays_only:true
});
const label=(tier:string)=>({primary:'Primär',secondary:'Sekundär',tertiary:'Tertiär'} as Record<string,string>)[tier]??'Primär';
const text=(v:unknown)=>v==null?'':String(v);
const toDate=(v?:string)=>v?new Date(v+'T12:00:00').toLocaleDateString('de-DE'):'–';
const groupText=(p:PlanningPlan)=>p.group_names?.join(' + ')||p.group_name||'–';
const yearsOf=(p:PlanningPlan):string=>Array.isArray(p.training_years)?p.training_years.join(', '):'1–3';
function priority(p:PlanningPlan,slot:number):string{
  const v=p.slot_priorities as Record<string,string>|undefined;
  return v?.[String(slot)]??'primary';
}
function formDraft(p:PlanningPlan):Draft{
  const defaults=blank();
  return {...defaults,name:p.name,
    group_names:p.group_names??(p.group_name?[p.group_name]:[]),
    training_years:Array.isArray(p.training_years)?p.training_years.map(Number):defaults.training_years,
    exclude_blind:p.exclude_blind===true,
    persons_per_turn:Number(p.persons_per_turn??2),
    slot_priorities:{...defaults.slot_priorities,...p.slot_priorities},
    interval_value:Number(p.interval_value??1),interval_unit:text(p.interval_unit||'week'),
    start_date:text(p.start_date).slice(0,10),end_date:text(p.end_date).slice(0,10),
    block_plan_id:text(p.block_plan_id),consider_school:p.consider_school!==false,
    consider_practicum:p.consider_practicum!==false,weekdays_only:p.weekdays_only!==false};
}
function matrix(entries:PlanningEntry[],plan:PlanningPlan,isAdmin:boolean,busy:boolean,onEdit:(e:PlanningEntry)=>void){
  const periods=new Map<string,PlanningEntry[]>();
  for(const row of entries){
    if(!periods.has(row.period_start))periods.set(row.period_start,[]);
    periods.get(row.period_start)!.push(row);
  }
  const slotCount=Math.max(1,Number(plan.persons_per_turn??1));
  return <div className="planning-table-wrap"><table className="planning-table">
    <thead><tr><th>Turn</th>{Array.from({length:slotCount},(_,i)=><th key={i}>
      Slot {i+1}<small className={'planning-slot-priority planning-slot-priority-'+priority(plan,i+1)}>
        {label(priority(plan,i+1))}</small></th>)}</tr></thead>
    <tbody>{!periods.size?<tr><td className="planning-empty" colSpan={slotCount+1}>
      Keine Einteilungen vorhanden.</td></tr>:
      [...periods].sort(([a],[b])=>a.localeCompare(b)).map(([period,rows])=>{
        const current=rows.some(row=>entryState(row)==='current');
        return <tr key={period} className={current?'planning-current':''}>
          <td><strong>{toDate(period)}</strong>{rows[0]?.period_end!==period&&<>
            {' – '}{toDate(rows[0]?.period_end)}</>}{current&&<small>Aktuell</small>}</td>
          {Array.from({length:slotCount},(_,i)=>{
            const row=rows.find(e=>Number(e.slot_no)===i+1);
            const empty=!row||row.assignment_state==='empty'||!row.user_guid;
            const closed=row?.assignment_state==='closed';
            const classes=[empty?'empty-slot':'',closed?'closed-slot':'',row?.manual_override?'manual-slot':'',
              row&&isAdmin&&!closed?'editable-slot':''].filter(Boolean).join(' ');
            return <td key={i} className={classes} tabIndex={row&&isAdmin&&!closed?0:undefined}
              title={row&&isAdmin&&!closed?'Slot '+(i+1)+' bearbeiten':undefined}
              onKeyDown={e=>{if(row&&isAdmin&&!closed&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onEdit(row);}}}
              onClick={()=>{if(row&&isAdmin&&!closed&&!busy)onEdit(row);}}>
              {closed?'GESCHLOSSEN':empty?'[EMPTY]':
                row?.display_name_snapshot||row?.username_snapshot||'[EMPTY]'}
              {row?.manual_override&&<small>Manuell</small>}</td>;
          })}</tr>;
      })}</tbody></table></div>;
}
export function PlanningAddonPage({isAdmin}:{isAdmin:boolean}){
  const [panel,setPanel]=useState<Panel>('plans');
  const [plans,setPlans]=useState<PlanningPlan[]>([]);
  const [blocks,setBlocks]=useState<PlanningBlockPlan[]>([]);
  const [practicums,setPracticums]=useState<PlanningPracticum[]>([]);
  const [roster,setRoster]=useState<PlanningPerson[]>([]);
  const [runtime,setRuntime]=useState<RuntimeConfig|null>(null);
  const [selected,setSelected]=useState<PlanningPlan|null>(null);
  const [selectedId,setSelectedId]=useState<string>('');
  const [modal,setModal]=useState<Modal>(null);
  const [draft,setDraft]=useState<Draft>(blank);
  const [editId,setEditId]=useState('');
  const [practice,setPractice]=useState<PlanningPracticum|null>(null);
  const [entry,setEntry]=useState<PlanningEntry|null>(null);
  const [entryPerson,setEntryPerson]=useState('');
  const [preview,setPreview]=useState<BlockImportPreview|null>(null);
  const [generationLog,setGenerationLog]=useState<Array<Record<string,unknown>>>([]);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [adConfigured,setAdConfigured]=useState<boolean|null>(null);
  const years=useMemo(()=>runtime?Array.from({length:runtime.training_year_max-runtime.training_year_min+1},
    (_,i)=>runtime.training_year_min+i):[1,2,3],[runtime]);
  const groups=useMemo(()=>runtime?.planning_groups??[...new Set(roster.map(x=>x.group_name).filter((v):v is string=>!!v))],[runtime,roster]);
  const locked=!!selected&&(selected.has_entries===true||Number(selected.generated_periods??0)>0);

  async function fetchAll(chosen?:string){
    const [p,b,pr,users]=await Promise.all([
      planningService.list(),planningService.blockPlans(),planningService.practicums(),planningService.roster()
    ]);
    setPlans(p);setBlocks(b);setPracticums(pr);setRoster(users);
    const id=chosen??selectedId??'';
    const next=id?p.find(x=>x.id===id):p[0];
    if(next){
      const detail=await planningService.detail(next.id);setSelected(detail);setSelectedId(next.id);
      if(isAdmin)void planningService.generationLog(next.id).then(setGenerationLog).catch(()=>setGenerationLog([]));
    }else{setSelected(null);setSelectedId('');setGenerationLog([]);}
  }
  useEffect(()=>{
    let alive=true;
    Promise.allSettled([loadRuntimeConfig(),planningService.adStatus()]).then(([conf,ad])=>{
      if(!alive)return;
      if(conf.status==='fulfilled')setRuntime(conf.value);
      if(ad.status==='fulfilled')setAdConfigured(ad.value.configured===true);
    });
    void fetchAll().catch(e=>setError(errorMessage(e))).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
    // Fetch on mount only. Subsequent changes pass an explicit selected id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function work(action:()=>Promise<void>){
    setBusy(true);setError('');setNotice('');
    try{await action();}catch(e){setError(errorMessage(e));}
    finally{setBusy(false);}
  }
  function choose(id:string){if(id===selectedId)return;void work(async()=>{
    const detail=await planningService.detail(id);setSelected(detail);setSelectedId(id);
    if(isAdmin)setGenerationLog(await planningService.generationLog(id));else setGenerationLog([]);
  });}
  function startPlan(item?:PlanningPlan){
    if(!isAdmin)return;
    if(!blocks.some(b=>b.is_usable)){setPanel('blocks');setError('Zuerst einen gültigen Blockwochenplan importieren.');return;}
    const initial=item?formDraft(item):blank();
    if(!item){
      initial.group_names=groups.length?[groups[0]]:[];
      initial.training_years=years;
      initial.block_plan_id=blocks.find(b=>b.is_usable)?.id??'';
    }
    setDraft(initial);setEditId(item?.id??'');setModal('plan');setError('');
  }
  async function savePlan(e:FormEvent){
    e.preventDefault();if(!isAdmin)return;
    await work(async()=>{
      if(!draft.group_names.length)throw new Error('Mindestens eine Gruppe auswählen.');
      if(!draft.training_years.length)throw new Error('Mindestens ein Ausbildungsjahr auswählen.');
      const slots=Array.from({length:draft.persons_per_turn},(_,i)=>draft.slot_priorities[String(i+1)]??'primary');
      if(slots.some(value=>!['primary','secondary','tertiary'].includes(value)))
        throw new Error('Jeder Slot muss einer Prioritätsstufe zugeordnet sein.');
      if(!slots.includes('primary'))throw new Error('Mindestens ein Primär-Slot erforderlich.');
      const body={...draft,slot_priorities:Object.fromEntries(
        Array.from({length:draft.persons_per_turn},(_,i)=>[String(i+1),draft.slot_priorities[String(i+1)]??'primary']))};
      const saved=editId?await planningService.update(editId,body):await planningService.create(body);
      setModal(null);await fetchAll(saved.id);setPanel('plans');setNotice('Plan gespeichert.');
    });
  }
  function gen(){if(!selected||!isAdmin||
    !window.confirm('Plan mit der aktuellen AD-Besetzung aktualisieren?'))return;
    void work(async()=>{
      const result=await planningService.generate(selected.id);
      await fetchAll(selected.id);
      setNotice((Number(result.refreshed_periods)||0)+' Turn(s) aktualisiert, '+
        (Number(result.created_periods)||0)+' neu ergänzt.');
    });
  }
  function removePlan(){if(!selected||!isAdmin||!window.confirm('Plan „'+selected.name+'“ löschen?'))return;
    void work(async()=>{await planningService.remove(selected.id);setSelectedId('');await fetchAll('');
      setNotice('Plan gelöscht.');});
  }
  function editSlot(row:PlanningEntry){
    if(!isAdmin)return;setEntry(row);setEntryPerson(row.user_guid??'');setModal('entry');
  }
  function saveEntry(e:FormEvent){
    e.preventDefault();if(!entry||!selected)return;
    void work(async()=>{await planningService.changeEntry(entry.id,entryPerson||null);
      await fetchAll(selected.id);setModal(null);setNotice('Zuweisung geändert.');});
  }
  async function pickBlock(file:File|null){
    if(!file)return;
    await work(async()=>{
      if(file.size>5*1024*1024)throw new Error('JSON-Datei darf höchstens 5 MB groß sein.');
      setPreview(previewBlockPlan(JSON.parse(await file.text()) as unknown));
    });
  }
  function importBlock(){
    if(!preview||!isAdmin)return;
    void work(async()=>{await planningService.importBlockPlan(preview.data);setModal(null);
      setPreview(null);await fetchAll(selectedId);setPanel('blocks');setNotice('Blockwochenplan importiert.');});
  }
  function removeBlock(item:PlanningBlockPlan){
    if(!isAdmin||!window.confirm('Blockwochenplan „'+item.name+'“ löschen?'))return;
    void work(async()=>{await planningService.removeBlockPlan(item.id);await fetchAll(selectedId);});
  }
  function startPractice(item?:PlanningPracticum){
    setPractice(item??{id:'',user_guid:'',start_date:'',end_date:'',company:'',note:''});
    setModal('practicum');
  }
  function savePractice(e:FormEvent){
    e.preventDefault();if(!practice||!isAdmin)return;
    void work(async()=>{
      const values={user_guid:practice.user_guid,start_date:practice.start_date,
        end_date:practice.end_date,company:practice.company??'',note:practice.note??''};
      if(practice.id)await planningService.updatePracticum(practice.id,values);
      else await planningService.createPracticum(values);
      setModal(null);await fetchAll(selectedId);setNotice('Praktikum gespeichert.');
    });
  }
  function removePractice(item:PlanningPracticum){
    if(!isAdmin||!window.confirm('Praktikum löschen?'))return;
    void work(async()=>{await planningService.removePracticum(item.id);await fetchAll(selectedId);});
  }
  const rows=selected?.entries??[];
  const parts=partitionEntries(rows);
  const upcoming=[...parts.current,...parts.future];
  const currentPersons=roster.filter(p=>p.active!==false&&p.eligible!==false);
  const modalTitle=modal==='plan'?(editId?'Plan bearbeiten':'Plan erstellen'):
    modal==='block'?'Blockwochenplan importieren':modal==='practicum'?'Praktikum erfassen':
    modal==='entry'?'Zuweisung bearbeiten':'';
  const muted=(v:unknown)=>text(v)||'–';
  function section(name:Panel,title:string){
    return <button className={'planning-tab'+(panel===name?' active':'')}
      role="tab" aria-selected={panel===name} key={name} onClick={()=>setPanel(name)}>{title}</button>;
  }
  return <div className="niko-planning" aria-label="Dienst- und Aufgabenplanung">
    <style>{css}</style>
    <div className="planning-header">
      <div><div className="planning-eyebrow">Planung</div><h1>Dienst- und Aufgabenplanung</h1></div>
      {isAdmin&&<div className="planning-admin-actions">
        <button type="button" className="button secondary" onClick={()=>{setPreview(null);setModal('block');}}>Blockwochenplan importieren</button>
        <button type="button" className="button secondary" onClick={()=>startPractice()}>Praktikum erfassen</button>
        <button type="button" className="button" onClick={()=>startPlan()}>Plan erstellen</button>
      </div>}
    </div>
    <div className="planning-tabs" role="tablist" aria-label="Planungsbereiche">
      {section('plans','Pläne')}{section('blocks','Blockwochenpläne')}{section('practicums','Praktika')}
    </div>
    {adConfigured===false&&<div className="planning-notice" role="status">Die AD-Dependency ist nicht konfiguriert. Planaktualisierungen benötigen AD.</div>}
    {error&&<div role="alert" className="planning-error">{error}</div>}
    {notice&&<div role="status" className="planning-notice">{notice}</div>}
    {loading&&<p role="status">Planung wird geladen …</p>}
    {!loading&&panel==='plans'&&<div className="planning-split">
      <aside className="planning-list-panel">
        <div className="planning-panel-head"><h2>Pläne</h2><span className="planning-count">{plans.length}</span></div>
        {plans.map(p=><button key={p.id} type="button"
          className={'planning-list-item'+(selectedId===p.id?' active':'')}
          onClick={()=>choose(p.id)}>
          <strong>{p.name}</strong><small>{groupText(p)} · {toDate(p.start_date)} – {toDate(p.end_date)}</small>
        </button>)}
        {!plans.length&&<p className="planning-empty">{isAdmin?'Noch keine Pläne. Erstelle oben den ersten Plan.':'Noch keine Pläne vorhanden.'}</p>}
      </aside>
      <section className="planning-detail" aria-label="Plandetails">
        {!selected?<div className="planning-empty">Wähle einen Plan aus.</div>:<>
          <div className="planning-detail-head">
            <div><h2>{selected.name}</h2><p>{groupText(selected)} ·
              {' Ausbildungsjahre: '+yearsOf(selected)} ·
              {selected.exclude_blind?' Blinde ausgeschlossen':' alle Blindstatus'} ·
              {' Blockwochenplan: '+muted(selected.block_plan_name)}</p></div>
            {isAdmin&&<div className="planning-detail-actions">
              <button type="button" className="button secondary" disabled={busy} onClick={()=>startPlan(selected)}>Bearbeiten</button>
              <button type="button" className="button" disabled={busy||adConfigured===false} onClick={gen}>Plan aktualisieren</button>
              <button type="button" className="button danger" disabled={busy} onClick={removePlan}>Löschen</button>
            </div>}
          </div>
          <div className="planning-summary">{([
            ['Zeitraum',toDate(selected.start_date)+' – '+toDate(selected.end_date)],
            ['Besetzung',muted(selected.persons_per_turn)+' Person(en) / '+muted(selected.interval_value)+' '+(
              selected.interval_unit==='day'?'Tag(e)':selected.interval_unit==='month'?'Monat(e)':'Woche(n)')],
            ['Slot-Prioritäten',Array.from({length:Number(selected.persons_per_turn??1)},(_,i)=>'S'+(i+1)+' '+label(priority(selected,i+1))).join(' · ')],
            ['Ausbildungsjahre',yearsOf(selected)],
            ['Schule',selected.consider_school?'wird berücksichtigt':'ignoriert'],
            ['Praktika',selected.consider_practicum?'werden berücksichtigt':'ignoriert'],
            ['Tagesplan',selected.interval_unit==='day'?(selected.weekdays_only?'Mo–Fr':'alle Kalendertage'):'—']
          ] as [string,string][]).map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
          {upcoming.length?matrix(upcoming,selected,isAdmin,busy,editSlot):
            <p className="planning-empty">{isAdmin?'Noch nicht generiert. Klicke auf „Plan aktualisieren“.':'Dieser Plan wurde noch nicht generiert.'}</p>}
          {!!parts.past.length&&<section><h3 className="planning-past-title">Vergangene Einteilungen</h3>
            {matrix(parts.past,selected,isAdmin,busy,editSlot)}</section>}
          {isAdmin&&<section className="planning-log"><h3>Generierungsprotokoll</h3>
            <details><summary>Entscheidungen anzeigen ({generationLog.length})</summary>
              <pre>{generationLog.map(v=>[v.period_start,v.display_name??v.username??v.user_guid??'–',
                v.decision,v.details?JSON.stringify(v.details):''].join(' · ')).join('\n')||'Noch keine Generierung.'}</pre>
            </details></section>}
        </>}
      </section>
    </div>}
    {!loading&&panel==='blocks'&&<section className="planning-table-wrap">
      <table className="planning-table"><thead><tr>
        {['Name','Schuljahr','Gültig von','Gültig bis','Wochen','Schema','Status',...(isAdmin?['Aktionen']:[])].map(t=><th key={t}>{t}</th>)}
      </tr></thead><tbody>{blocks.map(b=><tr key={b.id}>
        <td>{b.name}</td><td>{muted(b.school_year)}</td><td>{toDate(b.valid_from)}</td><td>{toDate(b.valid_until)}</td>
        <td>{muted((b as unknown as Record<string,unknown>).week_count)}</td><td>{muted((b as unknown as Record<string,unknown>).schema_version)}</td>
        <td className={b.is_usable?'planning-valid':'planning-outdated'}>{b.is_usable?'Gültig':'Abgelaufen'}</td>
        {isAdmin&&<td><button className="button secondary" disabled={busy} onClick={()=>removeBlock(b)}>Löschen</button></td>}
      </tr>)}
      {!blocks.length&&<tr><td colSpan={isAdmin?8:7} className="planning-empty">Noch kein Blockwochenplan importiert.</td></tr>}
      </tbody></table>
    </section>}
    {!loading&&panel==='practicums'&&<section className="planning-table-wrap">
      <table className="planning-table"><thead><tr>
        {['Azubi','Gruppe','Lehrjahr','Firma / Stelle','Von','Bis',...(isAdmin?['Aktionen']:[])].map(x=><th key={x}>{x}</th>)}
      </tr></thead><tbody>{practicums.map(p=><tr key={p.id}>
        <td>{p.display_name||p.user_guid}</td><td>{muted((p as unknown as Record<string,unknown>).group_name)}</td><td>{muted((p as unknown as Record<string,unknown>).training_year)}</td>
        <td>{muted(p.company)}</td><td>{toDate(p.start_date)}</td><td>{toDate(p.end_date)}</td>
        {isAdmin&&<td><button className="button secondary" onClick={()=>startPractice(p)}>Bearbeiten</button>{' '}
          <button className="button danger" onClick={()=>removePractice(p)}>Löschen</button></td>}
      </tr>)}
      {!practicums.length&&<tr><td colSpan={isAdmin?7:6} className="planning-empty">Keine Praktika vorhanden.</td></tr>}
      </tbody></table>
    </section>}
    {!!modal&&isAdmin&&<div className="planning-dialog-backdrop" role="presentation"
      onMouseDown={e=>{if(e.currentTarget===e.target&&!busy)setModal(null);}}>
      <section className="planning-dialog" role="dialog" aria-modal="true" aria-label={modalTitle}>
        <h2>{modalTitle}</h2>
        {modal==='plan'&&<form onSubmit={e=>void savePlan(e)}>
          {locked&&editId&&<p className="planning-notice">Generierter Plan: Rotationsfelder sind gesperrt.</p>}
          <div className="form-grid">
            <label className="span-2"><span className="field-label">Name</span><input required maxLength={200}
              value={draft.name} onChange={e=>setDraft(old=>({...old,name:e.target.value}))}/></label>
            <fieldset className="form-fieldset" disabled={!!editId&&locked}><legend className="field-label">Gruppen</legend>
              {groups.map(g=><label className="check-row" key={g}><input type="checkbox"
                checked={draft.group_names.includes(g)} onChange={e=>setDraft(old=>({...old,
                  group_names:e.target.checked?[...old.group_names,g]:old.group_names.filter(x=>x!==g)}))}/>{g}</label>)}
              {!groups.length&&<p>Keine AD-Planungsgruppen konfiguriert.</p>}</fieldset>
            <fieldset className="form-fieldset" disabled={!!editId&&locked}><legend className="field-label">Ausbildungsjahre</legend>
              {years.map(y=><label className="check-row" key={y}><input type="checkbox"
                checked={draft.training_years.includes(y)} onChange={e=>setDraft(old=>({...old,
                  training_years:e.target.checked?[...old.training_years,y]:old.training_years.filter(x=>x!==y)}))}/>{y}. Lehrjahr</label>)}
            </fieldset>
            <label className="check-row"><input type="checkbox" checked={draft.exclude_blind}
              disabled={!!editId&&locked} onChange={e=>setDraft(old=>({...old,exclude_blind:e.target.checked}))}/>
              Blinde Azubis ausschließen</label>
            <label><span className="field-label">Personen pro Turn</span><input type="number" min="1" max="20" required
              disabled={!!editId&&locked} value={draft.persons_per_turn} onChange={e=>setDraft(old=>({
                ...old,persons_per_turn:Math.min(20,Math.max(1,Number(e.target.value)||1))}))}/></label>
            <fieldset className="form-fieldset span-2" disabled={!!editId&&locked}>
              <legend className="field-label">Slot-Prioritäten</legend>
              <p>Jeder Slot gehört genau einer Stufe. Mindestens ein Primär-Slot ist Pflicht.</p>
              <div className="planning-slot-priority-editor">
                {([['primary','Primär','Pflicht'],['secondary','Sekundär','optional'],
                  ['tertiary','Tertiär','optional']] as const).map(([tier,title,hint])=>
                  <div className={'planning-slot-tier planning-slot-tier-'+tier} key={tier}>
                    <div className="planning-slot-tier-name"><strong>{title}</strong><small>{hint}</small></div>
                    <div className="planning-slot-checks">
                      {Array.from({length:draft.persons_per_turn},(_,i)=>i+1).map(i=>
                        <label className="check-row planning-slot-check" key={i}>
                          <input type="checkbox" aria-label={'Slot '+i+' '+title}
                            checked={(draft.slot_priorities[String(i)]??'primary')===tier}
                            onChange={e=>setDraft(previous=>({...previous,
                              slot_priorities:{...previous.slot_priorities,
                                [String(i)]:e.target.checked?tier:''}}))}/>
                          Slot {i}
                        </label>)}
                    </div>
                  </div>)}
              </div>
            </fieldset>
            <label><span className="field-label">Wechsel alle</span>
              <div className="interval-row"><input type="number" min="1" max="365" value={draft.interval_value} required
                disabled={!!editId&&locked} onChange={e=>setDraft(old=>({...old,interval_value:Number(e.target.value)}))}/>
                <select value={draft.interval_unit} disabled={!!editId&&locked}
                  onChange={e=>setDraft(old=>({...old,interval_unit:e.target.value}))}>
                  <option value="week">Woche(n)</option><option value="day">Tag(e)</option><option value="month">Monat(e)</option>
                </select></div></label>
            <label><span className="field-label">Start</span><input type="date" value={draft.start_date} required
              disabled={!!editId&&locked} onChange={e=>setDraft(old=>({...old,start_date:e.target.value}))}/></label>
            <label><span className="field-label">Ende</span><input type="date" value={draft.end_date} required
              onChange={e=>setDraft(old=>({...old,end_date:e.target.value}))}/></label>
            <label className="span-2"><span className="field-label">Blockwochenplan</span>
              <select required value={draft.block_plan_id} disabled={!!editId&&locked}
                onChange={e=>setDraft(old=>({...old,block_plan_id:e.target.value}))}>
                <option value="">Bitte auswählen</option>{blocks.map(b=><option key={b.id} value={b.id} disabled={!b.is_usable}>{b.name}</option>)}
              </select></label>
          </div>
          {([['consider_school','Schul-/Blockwochen berücksichtigen'],['consider_practicum','Praktika berücksichtigen'],
            ['weekdays_only','Bei Tages-Turnus nur Montag–Freitag planen']] as const).map(([key,name])=>
            <label className="check-row" key={key}><input type="checkbox" checked={draft[key]}
              onChange={e=>setDraft(old=>({...old,[key]:e.target.checked}))}/>{name}</label>)}
          <p>[EMPTY] = nicht genügend verfügbare Personen.</p>
          <div className="modal-actions"><button type="button" className="button secondary" onClick={()=>setModal(null)}>Abbrechen</button>
            <button className="button" type="submit" disabled={busy}>Speichern</button></div>
        </form>}
        {modal==='block'&&<div><p>JSON-Schema 1 oder 2.</p>
          <label><span className="field-label">JSON-Datei</span><input type="file" accept=".json,application/json"
            onChange={e=>{void pickBlock(e.target.files?.[0]??null);e.target.value='';}}/></label>
          <div className="planning-json-preview">{preview?
            [preview.name,preview.validFrom+' bis '+preview.validUntil,preview.weekCount+' Wochen',
              'Schema '+preview.schemaVersion].join('\n'):'Noch keine Datei gewählt.'}</div>
          <div className="modal-actions"><button className="button secondary" onClick={()=>setModal(null)}>Abbrechen</button>
            <button className="button" disabled={!preview||busy} onClick={importBlock}>Importieren</button></div>
        </div>}
        {modal==='practicum'&&practice&&<form onSubmit={savePractice}>
          <div className="form-grid">
            <label><span className="field-label">Azubi</span>
              <select required value={practice.user_guid} onChange={e=>setPractice(o=>o?{...o,user_guid:e.target.value}:o)}>
                <option value="">Person auswählen</option>{currentPersons.map(p=>
                  <option key={p.object_guid} value={p.object_guid}>{p.display_name}</option>)}</select></label>
            <label><span className="field-label">Firma / Stelle</span><input maxLength={200} required
              value={practice.company??''} onChange={e=>setPractice(o=>o?{...o,company:e.target.value}:o)}/></label>
            <label><span className="field-label">Von</span><input type="date" required value={practice.start_date}
              onChange={e=>setPractice(o=>o?{...o,start_date:e.target.value}:o)}/></label>
            <label><span className="field-label">Bis</span><input type="date" required value={practice.end_date}
              onChange={e=>setPractice(o=>o?{...o,end_date:e.target.value}:o)}/></label>
            <label className="span-2"><span className="field-label">Bemerkung</span><textarea rows={4} maxLength={1000}
              value={practice.note??''} onChange={e=>setPractice(o=>o?{...o,note:e.target.value}:o)}/></label>
          </div>
          <div className="modal-actions"><button type="button" className="button secondary" onClick={()=>setModal(null)}>Abbrechen</button>
            <button type="submit" className="button" disabled={busy}>Speichern</button></div>
        </form>}
        {modal==='entry'&&entry&&<form onSubmit={saveEntry}>
          <p>Slot {entry.slot_no} ({selected?label(priority(selected,entry.slot_no)):'Primär'})</p>
          <label><span className="field-label">Azubi</span><select value={entryPerson} onChange={e=>setEntryPerson(e.target.value)}>
            <option value="">[EMPTY]</option>{currentPersons.map(p=>
              <option key={p.object_guid} value={p.object_guid}>{p.display_name}</option>)}</select></label>
          <p>Manuelle Änderung; Rotation bleibt unverändert.</p>
          <div className="modal-actions"><button type="button" className="button secondary" onClick={()=>setModal(null)}>Abbrechen</button>
            <button type="submit" className="button" disabled={busy}>Übernehmen</button></div>
        </form>}
      </section>
    </div>}
  </div>;
}
