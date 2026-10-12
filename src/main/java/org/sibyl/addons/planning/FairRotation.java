package org.sibyl.addons.planning;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Independent per-slot round-robin; a user can hold at most one role per turn. */
public final class FairRotation {
    public static final String MODULE_ID = "Sibyl.planning";
    public static final String VERSION = "0.1.0-rc.1";
    public record Assignment(String primary, String secondary, String tertiary) {}
    private FairRotation() {}

    /**
     * Each slot has its OWN history. No slot repeats a participant while an
     * available never-selected participant exists in that slot cycle.
     * If candidates are temporarily blocked by other roles in the same turn,
     * the least-used available participant is chosen without resetting history.
     */
    public static List<Assignment> generate(List<String> participants, int turns) {
        if (participants == null || turns < 0 || turns > 10000)
            throw new IllegalArgumentException("Invalid participants or turns");
        List<String> people=List.copyOf(participants);
        if (people.size() < 3 || people.size() > 10000 ||
            people.stream().anyMatch(p -> p == null || p.isBlank()) ||
            new LinkedHashSet<>(people).size() != people.size())
            throw new IllegalArgumentException("At least three unique participants required");
        int n=people.size();
        int[][] used=new int[3][n];
        int[] cursor=new int[3];
        List<Assignment> assignments=new ArrayList<>();
        for(int turn=0; turn<turns; turn++) {
            Set<Integer> assigned=new HashSet<>();
            int[] pick=new int[3];
            for(int slot=0;slot<3;slot++) {
                int min=Integer.MAX_VALUE;
                for(int i=0;i<n;i++) if(!assigned.contains(i)) min=Math.min(min,used[slot][i]);
                int chosen=-1;
                for(int step=0;step<n;step++) {
                    int i=(cursor[slot]+step)%n;
                    if(!assigned.contains(i) && used[slot][i]==min) { chosen=i; break; }
                }
                if(chosen<0) throw new IllegalStateException("No eligible participant");
                pick[slot]=chosen;
                used[slot][chosen]++;
                cursor[slot]=(chosen+1)%n;
                assigned.add(chosen);
            }
            assignments.add(new Assignment(people.get(pick[0]),people.get(pick[1]),people.get(pick[2])));
        }
        return List.copyOf(assignments);
    }
}
