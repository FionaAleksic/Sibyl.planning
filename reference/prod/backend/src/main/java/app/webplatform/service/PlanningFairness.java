package app.webplatform.service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class PlanningFairness {
    private PlanningFairness() {}

    static final class State {
        private final Map<String, Integer> assignments = new HashMap<>();
        private final Map<String, LocalDate> lastAssigned = new HashMap<>();

        State(Collection<String> userGuids) {
            for (String guid : userGuids) {
                if (guid != null && !guid.isBlank()) assignments.putIfAbsent(guid, 0);
            }
        }

        void record(String guid, LocalDate periodStart) {
            if (guid == null || !assignments.containsKey(guid)) return;
            assignments.merge(guid, 1, Integer::sum);
            LocalDate old = lastAssigned.get(guid);
            if (old == null || periodStart.isAfter(old)) lastAssigned.put(guid, periodStart);
        }

        int assignments(String guid) {
            return assignments.getOrDefault(guid, 0);
        }

        LocalDate lastAssigned(String guid) {
            return lastAssigned.get(guid);
        }

        State copy() {
            State copy = new State(assignments.keySet());
            copy.assignments.clear();
            copy.assignments.putAll(assignments);
            copy.lastAssigned.putAll(lastAssigned);
            return copy;
        }

        Map<String,Integer> assignmentSnapshot() {
            return Map.copyOf(assignments);
        }

        Map<String,LocalDate> lastAssignedSnapshot() {
            return Map.copyOf(lastAssigned);
        }

        List<String> ordered(String trackKey, Collection<String> candidates) {
            List<String> ordered = new ArrayList<>(candidates);
            ordered.sort(comparator(trackKey));
            return ordered;
        }

        String pick(String trackKey, Collection<String> candidates) {
            return candidates.stream().min(comparator(trackKey)).orElse(null);
        }

        /**
         * Hard round-robin fairness:
         * only users on the currently lowest assignment level may receive the next turn.
         * A user blocked because they already occupy another slot in the same turn is NOT
         * silently skipped to a higher assignment level. If all due users are blocked,
         * this returns null and the caller must leave the slot empty for this turn.
         */
        String pickStrict(String trackKey, Collection<String> available, Collection<String> blockedThisTurn) {
            if (available == null || available.isEmpty()) return null;
            int min = Integer.MAX_VALUE;
            for (String guid : available) {
                if (guid == null || !assignments.containsKey(guid)) continue;
                min = Math.min(min, assignments(guid));
            }
            if (min == Integer.MAX_VALUE) return null;

            Set<String> blocked = blockedThisTurn == null
                    ? Set.of()
                    : new HashSet<>(blockedThisTurn);
            List<String> due = new ArrayList<>();
            for (String guid : available) {
                if (guid == null || blocked.contains(guid)) continue;
                if (assignments(guid) == min) due.add(guid);
            }
            return pick(trackKey, due);
        }

        private Comparator<String> comparator(String trackKey) {
            return (a, b) -> {
                int byCount = Integer.compare(assignments(a), assignments(b));
                if (byCount != 0) return byCount;

                LocalDate aLast = lastAssigned(a);
                LocalDate bLast = lastAssigned(b);
                if (aLast == null && bLast != null) return -1;
                if (aLast != null && bLast == null) return 1;
                if (aLast != null) {
                    int byLast = aLast.compareTo(bLast);
                    if (byLast != 0) return byLast;
                }

                int byStableRank = Long.compareUnsigned(stableRank(trackKey, a), stableRank(trackKey, b));
                if (byStableRank != 0) return byStableRank;
                return a.compareTo(b);
            };
        }
    }

    static long stableRank(String trackKey, String guid) {
        String value = String.valueOf(trackKey) + "|" + String.valueOf(guid);
        long hash = 0xcbf29ce484222325L;
        for (int i = 0; i < value.length(); i++) {
            hash ^= value.charAt(i);
            hash *= 0x100000001b3L;
        }
        return hash;
    }
}
