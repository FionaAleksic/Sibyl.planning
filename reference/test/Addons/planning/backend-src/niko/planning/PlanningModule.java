package niko.planning;

import app.webplatform.config.AppSettings;
import app.webplatform.db.Db;
import app.webplatform.error.ApiException;
import app.webplatform.platform.api.*;
import app.webplatform.service.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.*;

/** Routes the production PlanningService without changing rotation logic. */
public final class PlanningModule implements PlatformModuleBackend {
    private final ObjectMapper json=new ObjectMapper();
    private Db db;
    private PlanningService plans;
    private AuditService audit;
    private PlatformModuleContext context;

    @Override public void start(PlatformModuleContext context) {
        this.context=context;
        JdbcTemplate jdbc=new JdbcTemplate(context.dataSource());
        db=new Db(jdbc,json);
        StandardEnvironment env=new StandardEnvironment();
        AppSettings cfg=new AppSettings(env);
        plans=new PlanningService(db,jdbc,new ActiveDirectoryService(cfg,env),cfg);
        audit=new AuditService(db);
    }
    @Override public PlatformModuleResponse handle(PlatformModuleRequest r) {
        String verb=r.method().toUpperCase(Locale.ROOT), path=r.path();
        if(verb.equals("GET")&&path.equals("/ad/status"))return adStatus(r);
        if(verb.equals("GET")&&path.equals("/roster"))return result(plans.listPeople());
        if(verb.equals("POST")&&path.equals("/roster/sync")){
            admin(r);requireAd(r);
            return result(db.transaction(()->{
                Map<String,Object> synced=plans.syncRosterWithService();
                audit.record(r.username(),"sync","planning_roster",null,synced);
                return synced;
            }));
        }
        if(verb.equals("GET")&&path.equals("/rollover/status")){admin(r);return result(plans.rolloverStatus());}
        if(verb.equals("GET")&&path.equals("/block-plans"))return result(plans.listBlockPlans());
        if(verb.equals("GET")&&path.matches("/block-plans/[^/]+"))return result(plans.getBlockPlan(seg(path,2)));
        if(verb.equals("POST")&&path.equals("/block-plans/import")){
            admin(r);
            Map<String,Object> body=body(r);
            if(!(body.get("data") instanceof Map<?,?> data))throw ApiException.of(422,"Ungültiger Blockplan.");
            Map<String,Object> values=new LinkedHashMap<>();
            data.forEach((k,v)->values.put(String.valueOf(k),v));
            return result(db.transaction(()->{
                Map<String,Object> item=plans.importBlockPlan(values,r.username());
                Map<String,Object> details=new LinkedHashMap<>();
                for(String k:List.of("name","valid_until","week_count"))details.put(k,item.get(k));
                audit.record(r.username(),"import","planning_block_plan",String.valueOf(item.get("id")),details);
                return item;
            }));
        }
        if(verb.equals("DELETE")&&path.matches("/block-plans/[^/]+")){
            admin(r);String id=seg(path,2);
            return result(db.transaction(()->{
                Map<String,Object> old=plans.getBlockPlan(id);
                plans.deleteBlockPlan(id);
                audit.record(r.username(),"delete","planning_block_plan",id,Map.of("name",old.get("name")));
                return Map.of("ok",true);
            }));
        }
        if(verb.equals("GET")&&path.equals("/practicums"))return result(plans.listPracticums());
        if(verb.equals("POST")&&path.equals("/practicums")){
            admin(r);Map<String,Object> body=body(r);
            return result(db.transaction(()->{
                Map<String,Object> item=plans.createPracticum(body,r.username());
                auditPracticum(r,"create",item);
                return item;
            }));
        }
        if(verb.equals("PUT")&&path.matches("/practicums/[^/]+")){
            admin(r);String id=seg(path,2);Map<String,Object> body=body(r);
            return result(db.transaction(()->{
                Map<String,Object> item=plans.updatePracticum(id,body,r.username());
                auditPracticum(r,"update",item);
                return item;
            }));
        }
        if(verb.equals("DELETE")&&path.matches("/practicums/[^/]+")){
            admin(r);String id=seg(path,2);
            return result(db.transaction(()->{
                plans.deletePracticum(id);
                audit.record(r.username(),"delete","planning_practicum",id);
                return Map.of("ok",true);
            }));
        }
        if(verb.equals("GET")&&path.equals("/plans"))return result(plans.listPlans());
        if(verb.equals("GET")&&path.matches("/plans/[^/]+/generation-log")){
            admin(r);return result(plans.generationLog(seg(path,2),queryInt(r,"limit",500,1,2000)));
        }
        if(verb.equals("GET")&&path.matches("/plans/[^/]+"))return result(plans.getPlan(seg(path,2)));
        if(verb.equals("POST")&&path.equals("/plans")){
            admin(r);Map<String,Object> values=body(r);
            return result(db.transaction(()->{
                Map<String,Object> item=plans.createPlan(values,r.username());
                Map<String,Object> details=new LinkedHashMap<>();
                for(String k:List.of("name","group_names","start_date","end_date","interval_value","interval_unit"))
                    details.put(k,item.get(k));
                audit.record(r.username(),"create","planning_plan",String.valueOf(item.get("id")),details);
                return item;
            }));
        }
        if(verb.equals("PUT")&&path.matches("/plans/[^/]+")){
            admin(r);String id=seg(path,2);Map<String,Object> values=body(r);
            return result(db.transaction(()->{
                Map<String,Object> item=plans.updatePlan(id,values,r.username());
                Map<String,Object> details=new LinkedHashMap<>();
                details.put("name",item.get("name"));details.put("end_date",item.get("end_date"));
                audit.record(r.username(),"update","planning_plan",id,details);
                return item;
            }));
        }
        if(verb.equals("DELETE")&&path.matches("/plans/[^/]+")){
            admin(r);String id=seg(path,2);
            return result(db.transaction(()->{
                Map<String,Object> item=plans.deletePlan(id);
                audit.record(r.username(),"delete","planning_plan",id,Map.of("name",item.get("name")));
                return Map.of("ok",true);
            }));
        }
        if(verb.equals("POST")&&path.matches("/plans/[^/]+/generate")){
            admin(r);requireAd(r);String id=seg(path,2);
            // The exact same AD refresh and generation service as the legacy controller.
            return result(db.transaction(()->{
                plans.syncRosterWithService();
                Map<String,Object> item=plans.generatePlan(id,r.username());
                Map<String,Object> details=new LinkedHashMap<>(item);details.remove("plan");
                audit.record(r.username(),"generate","planning_plan",id,details);
                return item;
            }));
        }
        if(verb.equals("PUT")&&path.matches("/entries/[0-9]+")){
            admin(r);long id=Long.parseLong(seg(path,2));Map<String,Object> body=body(r);
            String guid=body.get("user_guid")==null?null:String.valueOf(body.get("user_guid"));
            return result(db.transaction(()->{
                Map<String,Object> item=plans.updateEntry(id,guid,r.username());
                Map<String,Object> details=new LinkedHashMap<>();
                for(String k:List.of("plan_id","period_start","slot_no","user_guid"))details.put(k,item.get(k));
                audit.record(r.username(),"override","planning_entry",Long.toString(id),details);
                return item;
            }));
        }
        return new PlatformModuleResponse(404,"application/json",Map.of("detail","Planungs-Endpunkt wurde nicht gefunden."));
    }
    private void auditPracticum(PlatformModuleRequest r,String action,Map<String,Object> item){
        Map<String,Object> details=new LinkedHashMap<>();
        for(String k:List.of("display_name","start_date","end_date"))details.put(k,item.get(k));
        audit.record(r.username(),action,"planning_practicum",String.valueOf(item.get("id")),details);
    }
    private PlatformModuleResponse adStatus(PlatformModuleRequest request){
        return context.modules().call("Sibyl.ad",new PlatformModuleRequest(
            "GET","/status",Map.of(),"application/json",new byte[0],
            request.username(),request.roles()));
    }
    private void requireAd(PlatformModuleRequest request){
        PlatformModuleResponse result=adStatus(request);
        if(result.status()!=200)throw ApiException.of(503,"AD-Dependency nicht erreichbar.");
        if(result.body() instanceof Map<?,?> m && !Boolean.TRUE.equals(m.get("configured")))
            throw ApiException.of(503,"AD-Integration nicht konfiguriert.");
    }
    private static void admin(PlatformModuleRequest r){
        if(r.roles().stream().noneMatch(role->role.equalsIgnoreCase("admin")))
            throw ApiException.of(403,"Administratorrolle erforderlich.");
    }
    private Map<String,Object> body(PlatformModuleRequest r){
        if(r.body().length==0)return Map.of();
        try{return json.readValue(r.body(),new TypeReference<Map<String,Object>>(){});}
        catch(Exception ex){throw ApiException.of(422,"Ungültige JSON-Anfrage.");}
    }
    private static int queryInt(PlatformModuleRequest r,String key,int fallback,int min,int max){
        List<String> values=r.query().get(key);
        if(values==null||values.isEmpty())return fallback;
        int n;
        try{n=Integer.parseInt(values.get(0));}
        catch(Exception ex){throw ApiException.of(422,"Ungültiger Parameter.");}
        if(n<min||n>max)throw ApiException.of(422,"Ungültiger Parameter.");
        return n;
    }
    private static String seg(String path,int i){return path.split("/")[i];}
    private static PlatformModuleResponse result(Object o){return PlatformModuleResponse.json(o);}
}
