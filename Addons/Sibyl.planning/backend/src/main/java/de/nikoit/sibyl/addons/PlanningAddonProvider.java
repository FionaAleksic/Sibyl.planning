package de.nikoit.sibyl.addons;
import java.util.List;
import org.springframework.stereotype.Component;
@Component
public class PlanningAddonProvider implements SibylAddonProvider {
 @Override public String type(){return "planning";}
 @Override public List<AddonConfigurationService.Field> settings(){
  return List.of(
   new AddonConfigurationService.Field("defaultDays","Tage pro Planlauf","number","Zeitraum für neue Einteilungen.","14",1,62,List.of()),
   new AddonConfigurationService.Field("allowSameDayDoubleBooking","Mehrfachzuteilung pro Tag","boolean","Erlaubt eine Person in mehreren Slotarten am selben Tag.","false",0,0,List.of()),
   new AddonConfigurationService.Field("includeWeekends","Wochenenden einplanen","boolean","Samstag und Sonntag bei der Planerzeugung berücksichtigen.","false",0,0,List.of()));
 }
}
