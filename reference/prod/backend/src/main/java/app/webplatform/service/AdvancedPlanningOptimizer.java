package app.webplatform.service;

import com.google.ortools.Loader;
import com.google.ortools.sat.BoolVar;
import com.google.ortools.sat.CpModel;
import com.google.ortools.sat.CpSolver;
import com.google.ortools.sat.CpSolverStatus;
import com.google.ortools.sat.LinearExpr;
import com.google.ortools.sat.LinearExprBuilder;
import com.google.ortools.sat.Literal;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

final class AdvancedPlanningOptimizer {
    private AdvancedPlanningOptimizer() {}

    static final String ENGINE = "cp-sat-global-v3";
    static final String FALLBACK_ENGINE = "strict-round-robin-v2";

    private static final long EMPTY_PENALTY = 1_000_000L;
    private static final long GAP_PENALTY_BASE = 20_000L;
    private static final long HISTORICAL_GAP_PENALTY_BASE = 1_000L;
    private static final long STABILITY_REWARD = 250L;

    record ManualSlot(String guid) {}

    record PeriodInput(
            LocalDate start,
            Set<String> available,
            Map<Integer, ManualSlot> manualSlots,
            Map<Integer, String> previousAutoAssignments
    ) {
        PeriodInput {
            Objects.requireNonNull(start);
            available = Set.copyOf(available == null ? Set.of() : available);
            manualSlots = Map.copyOf(manualSlots == null ? Map.of() : manualSlots);
            previousAutoAssignments = Map.copyOf(
                    previousAutoAssignments == null ? Map.of() : previousAutoAssignments
            );
        }
    }

    record Request(
            String planId,
            List<String> people,
            Map<Integer, String> slotTracks,
            List<PeriodInput> periods,
            Map<String, PlanningFairness.State> history,
            double maxSolveSeconds
    ) {
        Request {
            people = List.copyOf(people);
            slotTracks = Map.copyOf(slotTracks);
            periods = List.copyOf(periods);
            history = Map.copyOf(history);
            if (maxSolveSeconds <= 0) maxSolveSeconds = 8.0;
        }
    }

    record Result(
            Map<LocalDate, Map<Integer, String>> assignments,
            String engine,
            String solverStatus,
            boolean fallbackUsed,
            double objectiveValue,
            int emptySlots
    ) {}

    private record Event(
            int index,
            int periodIndex,
            int slot,
            String track,
            LocalDate date,
            boolean manual,
            String manualGuid,
            String previousGuid
    ) {}

    private static final class AutoVars {
        final Event event;
        final Map<String, BoolVar> byPerson = new LinkedHashMap<>();
        BoolVar empty;

        AutoVars(Event event) {
            this.event = event;
        }
    }

    static Result optimize(Request request) {
        try {
            return solveCpSat(request);
        } catch (Throwable failure) {
            return fallback(request, failure.getClass().getSimpleName());
        }
    }

    private static Result solveCpSat(Request request) {
        validate(request);
        Loader.loadNativeLibraries();

        CpModel model = new CpModel();
        List<Event> events = buildEvents(request);
        Map<Integer, AutoVars> autoVars = new LinkedHashMap<>();

        Map<String, Map<String, List<BoolVar>>> priorAuto =
                new LinkedHashMap<>();
        Map<String, Map<String, Integer>> priorManual =
                new LinkedHashMap<>();

        for (String track : allTracks(request)) {
            priorAuto.put(track, new LinkedHashMap<>());
            priorManual.put(track, new LinkedHashMap<>());
            for (String person : request.people()) {
                priorAuto.get(track).put(person, new ArrayList<>());
                int historical = request.history()
                        .getOrDefault(track, new PlanningFairness.State(request.people()))
                        .assignments(person);
                priorManual.get(track).put(person, historical);
            }
        }

        Map<Integer, Map<String, List<BoolVar>>> periodPersonVars =
                new LinkedHashMap<>();
        Map<Integer, Map<String, Integer>> periodManualCounts =
                new LinkedHashMap<>();

        LinearExprBuilder objective = LinearExpr.newBuilder();

        for (Event event : events) {
            periodPersonVars.computeIfAbsent(event.periodIndex(), k -> new LinkedHashMap<>());
            periodManualCounts.computeIfAbsent(event.periodIndex(), k -> new LinkedHashMap<>());

            if (event.manual()) {
                if (event.manualGuid() != null && request.people().contains(event.manualGuid())) {
                    priorManual.get(event.track()).merge(event.manualGuid(), 1, Integer::sum);
                    periodManualCounts.get(event.periodIndex())
                            .merge(event.manualGuid(), 1, Integer::sum);
                }
                continue;
            }

            PeriodInput period = request.periods().get(event.periodIndex());
            AutoVars vars = new AutoVars(event);
            autoVars.put(event.index(), vars);

            List<BoolVar> oneOf = new ArrayList<>();

            Map<String, com.google.ortools.sat.IntVar> countBeforeVars =
                    new LinkedHashMap<>();
            for (String person : request.people()) {
                if (!period.available().contains(person)) continue;
                com.google.ortools.sat.IntVar countVar = model.newIntVar(
                        0,
                        100_000,
                        "count_before_p" + event.periodIndex()
                                + "_s" + event.slot()
                                + "_" + safe(person)
                );
                model.addEquality(
                        countVar,
                        countBefore(
                                request, event.track(), person,
                                priorAuto, priorManual
                        )
                );
                countBeforeVars.put(person, countVar);
            }

            com.google.ortools.sat.IntVar minCount = null;
            if (!countBeforeVars.isEmpty()) {
                minCount = model.newIntVar(
                        0,
                        100_000,
                        "min_count_p" + event.periodIndex()
                                + "_s" + event.slot()
                );
                model.addMinEquality(
                        minCount,
                        new ArrayList<>(countBeforeVars.values())
                );
            }

            for (String person : request.people()) {
                if (!period.available().contains(person)) continue;

                BoolVar var = model.newBoolVar(
                        "x_p" + event.periodIndex()
                                + "_s" + event.slot()
                                + "_" + safe(person)
                );
                vars.byPerson.put(person, var);
                oneOf.add(var);

                periodPersonVars.get(event.periodIndex())
                        .computeIfAbsent(person, k -> new ArrayList<>())
                        .add(var);

                model.addEquality(
                        countBeforeVars.get(person),
                        minCount
                ).onlyEnforceIf(var);

                LocalDate historicalLast = request.history()
                        .getOrDefault(event.track(), new PlanningFairness.State(request.people()))
                        .lastAssigned(person);
                if (historicalLast != null) {
                    long days = ChronoUnit.DAYS.between(historicalLast, event.date());
                    if (days >= 0 && days < 35) {
                        objective.addTerm(
                                var,
                                HISTORICAL_GAP_PENALTY_BASE * (35 - days)
                        );
                    }
                }

                int rank = stableRankIndex(
                        request.planId() + "|" + event.track(),
                        person,
                        request.people()
                );
                objective.addTerm(var, rank);

                if (person.equals(event.previousGuid())) {
                    objective.addTerm(var, -STABILITY_REWARD);
                }
            }

            vars.empty = model.newBoolVar(
                    "empty_p" + event.periodIndex() + "_s" + event.slot()
            );
            oneOf.add(vars.empty);
            model.addEquality(LinearExpr.sum(oneOf.toArray(BoolVar[]::new)), 1);
            objective.addTerm(vars.empty, EMPTY_PENALTY);

            for (Map.Entry<String, BoolVar> e : vars.byPerson.entrySet()) {
                priorAuto.get(event.track()).get(e.getKey()).add(e.getValue());
            }
        }

        // A person may occupy at most one slot in the same turn.
        for (int periodIndex = 0; periodIndex < request.periods().size(); periodIndex++) {
            Map<String, List<BoolVar>> varsByPerson =
                    periodPersonVars.getOrDefault(periodIndex, Map.of());
            Map<String, Integer> manualCounts =
                    periodManualCounts.getOrDefault(periodIndex, Map.of());

            for (String person : request.people()) {
                int manual = manualCounts.getOrDefault(person, 0);
                if (manual > 1) {
                    throw new IllegalStateException(
                            "duplicate manual assignment in one turn for " + person
                    );
                }

                List<BoolVar> vars = varsByPerson.getOrDefault(person, List.of());
                if (vars.isEmpty()) continue;
                model.addLessOrEqual(
                        LinearExpr.sum(vars.toArray(BoolVar[]::new)),
                        1 - manual
                );
            }
        }

        // Strict per-track fairness already creates the maximum round-robin gap.
        // The global model therefore focuses on collision-free feasibility, preserving
        // existing good assignments and minimizing unavoidable empty slots.
        // Seed CP-SAT with the proven strict-round-robin schedule. This gives
        // the optimizer an immediate feasible solution and lets it spend its
        // time improving spacing/stability instead of rediscovering feasibility.
        addFallbackHints(request, autoVars, model);

        model.minimize(objective);

        CpSolver solver = new CpSolver();
        solver.getParameters().setMaxTimeInSeconds(request.maxSolveSeconds());
        solver.getParameters().setNumSearchWorkers(1);
        solver.getParameters().setRandomSeed(20261007);

        CpSolverStatus status = solver.solve(model);
        if (status != CpSolverStatus.OPTIMAL && status != CpSolverStatus.FEASIBLE) {
            return fallback(request, status.name());
        }

        Map<LocalDate, Map<Integer, String>> assignments = new LinkedHashMap<>();
        int emptySlots = 0;

        for (PeriodInput period : request.periods()) {
            assignments.put(period.start(), new LinkedHashMap<>());
            for (Map.Entry<Integer, ManualSlot> manual : period.manualSlots().entrySet()) {
                assignments.get(period.start())
                        .put(manual.getKey(), manual.getValue().guid());
            }
        }

        for (AutoVars vars : autoVars.values()) {
            String chosen = null;
            for (Map.Entry<String, BoolVar> candidate : vars.byPerson.entrySet()) {
                if (solver.booleanValue(candidate.getValue())) {
                    chosen = candidate.getKey();
                    break;
                }
            }
            if (chosen == null) emptySlots++;
            assignments.get(vars.event.date()).put(vars.event.slot(), chosen);
        }

        freezeNested(assignments);
        return new Result(
                assignments,
                ENGINE,
                status.name(),
                false,
                solver.objectiveValue(),
                emptySlots
        );
    }

    private static void addFallbackHints(
            Request request,
            Map<Integer, AutoVars> autoVars,
            CpModel model
    ) {
        Result hint = fallback(request, "HINT");
        for (AutoVars vars : autoVars.values()) {
            Map<Integer,String> turn =
                    hint.assignments().getOrDefault(vars.event.date(), Map.of());
            String chosen = turn.get(vars.event.slot());

            for (Map.Entry<String,BoolVar> candidate : vars.byPerson.entrySet()) {
                model.addHint(
                        candidate.getValue(),
                        candidate.getKey().equals(chosen)
                );
            }
            model.addHint(vars.empty, chosen == null);
        }
    }

    private static void addSpacingObjective(
            Request request,
            List<Event> events,
            Map<Integer, AutoVars> autoVars,
            CpModel model,
            LinearExprBuilder objective
    ) {
        for (String track : allTracks(request)) {
            for (String person : request.people()) {
                List<Event> personEvents = new ArrayList<>();
                for (Event event : events) {
                    if (event.manual()) continue;
                    if (!track.equals(event.track())) continue;
                    AutoVars vars = autoVars.get(event.index());
                    if (vars != null && vars.byPerson.containsKey(person)) {
                        personEvents.add(event);
                    }
                }

                for (int i = 0; i < personEvents.size(); i++) {
                    Event a = personEvents.get(i);
                    BoolVar av = autoVars.get(a.index()).byPerson.get(person);
                    for (int j = i + 1; j < personEvents.size(); j++) {
                        Event b = personEvents.get(j);
                        int gap = b.periodIndex() - a.periodIndex();
                        if (gap <= 0) continue;
                        if (gap > 5) break;

                        BoolVar bv = autoVars.get(b.index()).byPerson.get(person);
                        BoolVar both = model.newBoolVar(
                                "gap_" + safe(track) + "_" + safe(person)
                                        + "_" + a.index() + "_" + b.index()
                        );

                        model.addBoolAnd(new Literal[]{av, bv}).onlyEnforceIf(both);
                        model.addBoolOr(new Literal[]{av.not(), bv.not(), both});

                        objective.addTerm(
                                both,
                                GAP_PENALTY_BASE * (6L - gap)
                        );
                    }
                }
            }
        }
    }

    private static LinearExpr countBefore(
            Request request,
            String track,
            String person,
            Map<String, Map<String, List<BoolVar>>> priorAuto,
            Map<String, Map<String, Integer>> priorManual
    ) {
        LinearExprBuilder builder = LinearExpr.newBuilder();
        builder.add(priorManual.get(track).getOrDefault(person, 0));
        for (BoolVar var : priorAuto.get(track).getOrDefault(person, List.of())) {
            builder.addTerm(var, 1);
        }
        return builder.build();
    }

    private static List<Event> buildEvents(Request request) {
        List<Event> events = new ArrayList<>();
        int index = 0;
        List<Integer> slots = new ArrayList<>(request.slotTracks().keySet());
        slots.sort(Integer::compareTo);

        for (int p = 0; p < request.periods().size(); p++) {
            PeriodInput period = request.periods().get(p);
            for (int slot : slots) {
                ManualSlot manual = period.manualSlots().get(slot);
                String previous = period.previousAutoAssignments().get(slot);
                events.add(new Event(
                        index++,
                        p,
                        slot,
                        request.slotTracks().getOrDefault(slot, "primary"),
                        period.start(),
                        manual != null,
                        manual == null ? null : manual.guid(),
                        previous
                ));
            }
        }
        return events;
    }

    private static Result fallback(Request request, String reason) {
        Map<String, PlanningFairness.State> states = new LinkedHashMap<>();
        for (String track : allTracks(request)) {
            PlanningFairness.State history = request.history().get(track);
            states.put(
                    track,
                    history == null
                            ? new PlanningFairness.State(request.people())
                            : history.copy()
            );
        }

        Map<LocalDate, Map<Integer, String>> out = new LinkedHashMap<>();
        int emptySlots = 0;
        List<Integer> slots = new ArrayList<>(request.slotTracks().keySet());
        slots.sort(Integer::compareTo);

        for (PeriodInput period : request.periods()) {
            Map<Integer, String> assignments = new LinkedHashMap<>();
            Set<String> selected = new HashSet<>();

            for (int slot : slots) {
                String track = request.slotTracks().getOrDefault(slot, "primary");
                ManualSlot manual = period.manualSlots().get(slot);
                if (manual != null) {
                    assignments.put(slot, manual.guid());
                    if (manual.guid() != null) {
                        selected.add(manual.guid());
                        states.get(track).record(manual.guid(), period.start());
                    }
                    continue;
                }

                String chosen = states.get(track).pickStrict(
                        request.planId() + "|" + track,
                        period.available(),
                        selected
                );
                assignments.put(slot, chosen);
                if (chosen == null) {
                    emptySlots++;
                } else {
                    selected.add(chosen);
                    states.get(track).record(chosen, period.start());
                }
            }
            out.put(period.start(), assignments);
        }

        freezeNested(out);
        return new Result(
                out,
                FALLBACK_ENGINE,
                "FALLBACK:" + reason,
                true,
                Double.NaN,
                emptySlots
        );
    }

    private static Set<String> allTracks(Request request) {
        Set<String> tracks = new LinkedHashSet<>(
                request.slotTracks().values()
        );
        tracks.addAll(List.of("primary", "secondary", "tertiary"));
        return tracks;
    }

    private static int stableRankIndex(
            String trackKey,
            String person,
            Collection<String> people
    ) {
        List<String> ordered = new ArrayList<>(people);
        ordered.sort(Comparator
                .comparingLong((String p) -> PlanningFairness.stableRank(trackKey, p))
                .thenComparing(String::compareTo));
        return Math.max(0, ordered.indexOf(person));
    }

    private static String safe(String value) {
        return value == null
                ? "null"
                : value.replaceAll("[^A-Za-z0-9_]", "_");
    }

    private static void validate(Request request) {
        if (request.planId() == null || request.planId().isBlank()) {
            throw new IllegalArgumentException("planId missing");
        }
        if (request.people().isEmpty() || request.slotTracks().isEmpty()) {
            throw new IllegalArgumentException("people or slots missing");
        }
        Set<String> unique = new HashSet<>(request.people());
        if (unique.size() != request.people().size()) {
            throw new IllegalArgumentException("duplicate people");
        }
    }

    private static void freezeNested(
            Map<LocalDate, Map<Integer, String>> assignments
    ) {
        for (Map.Entry<LocalDate, Map<Integer, String>> e :
                new ArrayList<>(assignments.entrySet())) {
            e.setValue(Collections.unmodifiableMap(
                    new LinkedHashMap<>(e.getValue())
            ));
        }
    }
}
