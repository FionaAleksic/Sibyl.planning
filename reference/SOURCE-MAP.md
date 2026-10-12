# Planning parity source map

These are immutable source **snapshots**, not executable Core plugins. Niko Test SHA: `0431c74405fdd79f8f4620ebdb2b535b7913eb83`; Niko production-source SHA: `c97708e0172a3e67b0df522fbb98087935d0a3d6`.

- `reference/test/Addons/planning/module.json`
- `reference/test/Addons/planning/backend-src/niko/planning/PlanningModule.java`
- `reference/test/Addons/planning/frontend-src/PlanningAddonPage.tsx`
- `reference/test/Addons/planning/frontend-src/planning.css`
- `reference/test/frontend-next/src/modules/planning/pages/PlanningPage.tsx`
- `reference/prod/backend/src/main/java/app/webplatform/service/PlanningFairness.java`
- `reference/prod/backend/src/main/java/app/webplatform/service/AdvancedPlanningOptimizer.java`

Use the original CSS, React design and API contracts when porting. The future Sibyl Core plugin SDK must replace all `app.webplatform.*` imports. The fair-turn algorithm in the compiled prerelease is independently tested, but does NOT yet replace the complete production optimizer, database, roster import or user interface. AD access must be brokered through `Sibyl.ad`. No production changes.
