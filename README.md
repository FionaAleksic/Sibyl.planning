# Sibyl.planning

Erstes Pre-Release 0.1.0-rc.2. Unabhängiger Java-21-Kern für faire Drei-Slot-Planung (Primär / Sekundär / weiterer Slot). Jede Slotart führt unabhängig ihre eigenen Zähler, keine Person erscheint zweimal in derselben Runde. Die Testreihe prüft Fairness mit 3 bis 12 Personen über 70 Runden pro Größe. Build: `bash scripts/build-release.sh`.

Die fachliche Vorlage stammt aus dem bisherigen [Niko Planungsmodul](https://github.com/FionaAleksic/Niko_Web-System/tree/Test/Addons/planning) und dem [Produktiv-Algorithmus](https://github.com/FionaAleksic/Niko_Web-System/blob/main/backend/src/main/java/app/webplatform/service/PlanningFairness.java). **Kein 1:1-Ersatz der vollständigen Planung:** AD-Azubiimport, Datenbankschema, React-Ansicht, Blockpläne, Praktika und Plan-CRUD benötigen den künftigen Core-Plugin-Lifecycle und API-Adapter. Das RC.7-System kann den verifizierten ZIP-Release herunterladen, noch nicht aktivieren. `Sibyl.ad` ist Pflichtabhängigkeit für AD-Roster.

## Eigenes Deployment

Das Release stellt `deployment.json` und `ui/index.html` bereit. Core registriert die vom Addon gelieferte Oberfläche ohne Planungs-spezifische Installationslogik; die Rotation erfolgt vorerst direkt in der isolierten Browser-Vorschau. Vollständige Planung benötigt eine separate Backend-Laufzeit.
