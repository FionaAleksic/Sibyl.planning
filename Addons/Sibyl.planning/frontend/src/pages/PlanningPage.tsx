import {useCallback,useEffect,useState} from 'react';
import type {Credentials} from '../types/domain';
import {request} from '../services/api';
type Participant={username:string;active:boolean};
type Slot={id:number;date:string;kind:'PRIMARY'|'SECONDARY'|'TERTIARY';username:string};
const endpoint='/api/v1/addons/Sibyl.planning';
const kindLabel:Record<string,string>={PRIMARY:'Primär',SECONDARY:'Sekundär',TERTIARY:'Tertiär'};
const today=()=>new Date().toLocaleDateString('en-CA');
const explain=(e:unknown)=>e instanceof Error?e.message:'Unbekannter Fehler';
export default function PlanningPage({credentials,admin}:{credentials:Credentials;admin:boolean}){
 const [participants,setParticipants]=useState<Participant[]>([]);
 const [slots,setSlots]=useState<Slot[]>([]);
 const [person,setPerson]=useState('');
 const [from,setFrom]=useState(today());
 const [days,setDays]=useState(14);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const load=useCallback(async()=>{
  const [p,s]=await Promise.all([
   request<Participant[]>(endpoint+'/participants',credentials),
   request<Slot[]>(endpoint+'/slots?from='+encodeURIComponent(from),credentials)]);
  setParticipants(p);setSlots(s);
 },[credentials,from]);
 useEffect(()=>{void load().catch(e=>setError(explain(e)))},[load]);
 async function run(operation:()=>Promise<unknown>,success:string){
  setBusy(true);setError('');setNotice('');
  try{await operation();await load();setNotice(success)}catch(e){setError(explain(e))}finally{setBusy(false)}
 }
 const grouped=Object.entries(slots.reduce<Record<string,Slot[]>>((a,s)=>{
  (a[s.date]??=[]).push(s);return a;
 },{}));
 return <section className="resource-page">
  <div className="page-heading"><div><div className="eyebrow">SIBYL / PLANNING</div><h1>Dienstplanung</h1>
   <p>Primär-, Sekundär- und Tertiärrotation werden unabhängig und fair verteilt.</p></div></div>
  {error&&<div className="error" role="alert">{error}</div>}
  {notice&&<div className="success-note" role="status">{notice}</div>}
  {admin&&<div className="sibyl-addon-section"><h2>Plan erstellen</h2>
   <div className="sibyl-inline-fields"><label>Ab Datum<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>Tage<input type="number" min={1} max={62} value={days} onChange={e=>setDays(Number(e.target.value))}/></label>
    <button className="primary" disabled={busy||!from||days<1||days>62}
     onClick={()=>void run(()=>request(endpoint+'/generate',credentials,{method:'POST',body:JSON.stringify({startDate:from,days})}),'Plan wurde erzeugt.')}>Plan generieren</button>
   </div><p>Bestehende Einteilungen bleiben erhalten. Wochenende und Doppelbelegung können unter Administration → Addons → Planung konfiguriert werden.</p>
   <h3>Teilnehmende</h3>
   <form className="sibyl-inline-fields" onSubmit={e=>{e.preventDefault();void run(
     ()=>request(endpoint+'/participants',credentials,{method:'POST',body:JSON.stringify({username:person})}),
     'Person hinzugefügt.').then(()=>setPerson(''))}}>
    <input aria-label="Teilnehmende Person" placeholder="Anzeigename oder AD-Benutzerkennung"
     value={person} onChange={e=>setPerson(e.target.value)} maxLength={100} required/>
    <button className="primary" disabled={busy||!person.trim()}>Hinzufügen</button>
   </form>
   <div className="sibyl-people">{participants.map(p=><div key={p.username}>
    <span>{p.username} {p.active?'':'(inaktiv)'}</span>
    {p.active&&<button className="secondary" disabled={busy} onClick={()=>void run(
     ()=>request(endpoint+'/participants/'+encodeURIComponent(p.username),credentials,{method:'DELETE'}),'Person deaktiviert.')}>Deaktivieren</button>}
   </div>)}</div>
  </div>}
  <div className="sibyl-addon-section"><div className="sibyl-inline-fields"><h2>Einteilungen</h2>
   {!admin&&<label>Ab Datum<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>}
   <button className="secondary" onClick={()=>void load().catch(e=>setError(explain(e)))}>Aktualisieren</button>
  </div>
  {grouped.length===0?<p>Für diesen Zeitraum sind noch keine Einteilungen vorhanden.</p>:
   <table className="sibyl-table"><thead><tr><th>Datum</th><th>Slot</th><th>Person</th>{admin&&<th>Aktion</th>}</tr></thead>
   <tbody>{grouped.flatMap(([date,entries])=>entries.map(s=><tr key={s.id}>
    <td>{date}</td><td>{kindLabel[s.kind]??s.kind}</td><td>{s.username}</td>
    {admin&&<td><button className="secondary" disabled={busy} onClick={()=>void run(
     ()=>request(endpoint+'/slots/'+s.id,credentials,{method:'DELETE'}),'Einteilung entfernt.')}>Entfernen</button></td>}
   </tr>))}</tbody></table>}
  </div>
 </section>;
}
