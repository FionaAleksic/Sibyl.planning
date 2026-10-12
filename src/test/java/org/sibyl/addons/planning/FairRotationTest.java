package org.sibyl.addons.planning;
import java.util.*;
public final class FairRotationTest {
    public static void main(String[] args) {
        for (int total=3;total<=12;total++) {
            List<String> people=new ArrayList<>();
            for(int i=0;i<total;i++) people.add("P"+i);
            var plans=FairRotation.generate(people,70);
            int[][] count=new int[3][total];
            for (var a:plans) {
                List<String> slots=List.of(a.primary(),a.secondary(),a.tertiary());
                check(new HashSet<>(slots).size()==3,"one participant at most once per turn");
                for(int slot=0;slot<3;slot++) count[slot][people.indexOf(slots.get(slot))]++;
            }
            for(int slot=0;slot<3;slot++) {
                int min=Arrays.stream(count[slot]).min().orElseThrow();
                int max=Arrays.stream(count[slot]).max().orElseThrow();
                check(max-min<=1,"independent fairness across slot "+slot+" for "+total+" participants");
            }
        }
        check(FairRotation.generate(List.of("a","b","c","d"),8)
            .equals(FairRotation.generate(List.of("a","b","c","d"),8)),"deterministic");
        try { FairRotation.generate(List.of("a","a","c"),1); throw new AssertionError(); }
        catch(IllegalArgumentException expected) {}
        System.out.println("FairRotationTest PASS");
    }
    private static void check(boolean value,String what){ if(!value)throw new AssertionError(what); }
}
