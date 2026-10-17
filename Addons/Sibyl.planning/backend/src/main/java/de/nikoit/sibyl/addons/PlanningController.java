package de.nikoit.sibyl.addons;

import java.time.LocalDate;
import java.time.DayOfWeek;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/addons/Sibyl.planning")
public class PlanningController {
 public record Participant(String username,boolean active) {}
 public record ParticipantInput(String username) {}
 public record Slot(long id,String date,String kind,String username) {}
 public record GenerateInput(String startDate,Integer days) {}
 private record Rotation(int count,LocalDate last) {}
 private static final List<String> KINDS=List.of("PRIMARY","SECONDARY","TERTIARY");
 private final JdbcTemplate db;
 private final AddonRegistry registry;
 private final AddonConfigurationService config;
 private final AuditService audit;
 public PlanningController(JdbcTemplate db,AddonRegistry registry,AddonConfigurationService config,AuditService audit){
  this.db=db;this.registry=registry;this.config=config;this.audit=audit;
 }
 private void check(Authentication auth){registry.accessible("Sibyl.planning",auth);}
 private void admin(Authentication auth){
  check(auth);if(!registry.isAdmin(auth))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Admin required");
 }
 private LocalDate parse(String value){
  try{return LocalDate.parse(value);}catch(DateTimeParseException|NullPointerException ex){
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid ISO date");
  }
 }
 @GetMapping("/participants")
 public List<Participant> participants(Authentication auth){
  check(auth);
  return db.query("SELECT username,active FROM sibyl_planning_participants ORDER BY username",
   (rs,i)->new Participant(rs.getString(1),rs.getBoolean(2)));
 }
 @PostMapping("/participants")
 @Transactional
 public void add(@RequestBody ParticipantInput input,Authentication auth){
  admin(auth);
  if(input==null||input.username()==null||!input.username().trim().matches("[\\p{L}0-9._@ -]{2,100}"))
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid username");
  db.update("INSERT INTO sibyl_planning_participants(username,active) VALUES(?,TRUE) ON DUPLICATE KEY UPDATE active=TRUE",input.username().trim());
  audit.record(auth.getName(),"PLAN_PARTICIPANT_ADD",input.username().trim());
 }
 @DeleteMapping("/participants/{username}")
 @Transactional
 public void remove(@PathVariable String username,Authentication auth){
  admin(auth);
  Integer used=db.queryForObject("SELECT COUNT(*) FROM sibyl_planning_slots WHERE assigned_username=?",Integer.class,username);
  if(used!=null&&used>0)db.update("UPDATE sibyl_planning_participants SET active=FALSE WHERE username=?",username);
  else db.update("DELETE FROM sibyl_planning_participants WHERE username=?",username);
  audit.record(auth.getName(),"PLAN_PARTICIPANT_DISABLE",username);
 }
 @GetMapping("/slots")
 public List<Slot> slots(@RequestParam(defaultValue="") String from,Authentication auth){
  check(auth);
  LocalDate date=from.isBlank()?LocalDate.now().minusDays(7):parse(from);
  return db.query("SELECT id,slot_date,slot_kind,assigned_username FROM sibyl_planning_slots WHERE slot_date>=? ORDER BY slot_date,FIELD(slot_kind,'PRIMARY','SECONDARY','TERTIARY') LIMIT 300",
   (rs,i)->new Slot(rs.getLong(1),rs.getDate(2).toLocalDate().toString(),rs.getString(3),rs.getString(4)),java.sql.Date.valueOf(date));
 }
 @PostMapping("/generate")
 @Transactional
 public List<Slot> generate(@RequestBody GenerateInput input,Authentication auth){
  admin(auth);
  if(input==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Missing input");
  LocalDate start=parse(input.startDate());
  int days=input.days()==null?config.integerValue("Sibyl.planning","defaultDays"):input.days();
  if(days<1||days>62||start.isBefore(LocalDate.now().minusDays(31))||start.isAfter(LocalDate.now().plusYears(2)))
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid planning range");
  List<String> names=db.query("SELECT username FROM sibyl_planning_participants WHERE active=TRUE ORDER BY username FOR UPDATE",(rs,i)->rs.getString(1));
  if(names.isEmpty())throw new ResponseStatusException(HttpStatus.CONFLICT,"Keine aktiven Teilnehmenden");
  boolean doubleBooking=config.boolValue("Sibyl.planning","allowSameDayDoubleBooking");
  boolean weekends=config.boolValue("Sibyl.planning","includeWeekends");
  if(!doubleBooking&&names.size()<KINDS.size())
   throw new ResponseStatusException(HttpStatus.CONFLICT,"Für drei Slotarten werden mindestens drei Teilnehmende benötigt");
  Map<String,Map<String,Rotation>> stats=new HashMap<>();
  for(String kind:KINDS)stats.put(kind,new HashMap<>());
  db.query("SELECT slot_kind,assigned_username,COUNT(*),MAX(slot_date) FROM sibyl_planning_slots GROUP BY slot_kind,assigned_username",rs->{
   String k=rs.getString(1);
   if(stats.containsKey(k))stats.get(k).put(rs.getString(2),new Rotation(rs.getInt(3),rs.getDate(4).toLocalDate()));
  });
  for(int day=0;day<days;day++){
   LocalDate date=start.plusDays(day);
   if(!weekends&&(date.getDayOfWeek()==DayOfWeek.SATURDAY||date.getDayOfWeek()==DayOfWeek.SUNDAY))continue;
   Set<String> taken=new HashSet<>(db.query("SELECT assigned_username FROM sibyl_planning_slots WHERE slot_date=?",
     (rs,i)->rs.getString(1),java.sql.Date.valueOf(date)));
   Set<String> present=new HashSet<>(db.query("SELECT slot_kind FROM sibyl_planning_slots WHERE slot_date=?",
     (rs,i)->rs.getString(1),java.sql.Date.valueOf(date)));
   for(String kind:KINDS){
    if(present.contains(kind))continue;
    Map<String,Rotation> map=stats.get(kind);
    String picked=names.stream().filter(n->doubleBooking||!taken.contains(n))
     .min(Comparator.comparingInt((String n)->map.getOrDefault(n,new Rotation(0,LocalDate.MIN)).count())
      .thenComparing(n->map.getOrDefault(n,new Rotation(0,LocalDate.MIN)).last())
      .thenComparing(n->n))
     .orElseThrow(()->new ResponseStatusException(HttpStatus.CONFLICT,"Zu wenige freie Teilnehmende am "+date));
    db.update("INSERT INTO sibyl_planning_slots(slot_date,slot_kind,assigned_username,created_by) VALUES(?,?,?,?)",
     java.sql.Date.valueOf(date),kind,picked,auth.getName());
    Rotation old=map.getOrDefault(picked,new Rotation(0,LocalDate.MIN));
    map.put(picked,new Rotation(old.count()+1,date));taken.add(picked);
   }
  }
  audit.record(auth.getName(),"PLAN_GENERATE",start+":"+days);
  return slots(start.toString(),auth);
 }
 @DeleteMapping("/slots/{id}")
 @Transactional
 public void delete(@PathVariable long id,Authentication auth){
  admin(auth);
  if(db.update("DELETE FROM sibyl_planning_slots WHERE id=?",id)==0)
   throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Slot not found");
  audit.record(auth.getName(),"PLAN_SLOT_DELETE",Long.toString(id));
 }
}
