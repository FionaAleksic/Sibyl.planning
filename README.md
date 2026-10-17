# Sibyl.planning

**Test-Integration 0.7.0** – Planungsaddon für Sibyl System.

- Provider-ID: `Sibyl.planning`, Modultyp: `planning`.
- Abhängigkeit: `Sibyl.ad`.
- Daten: `sibyl_planning_participants` und `sibyl_planning_slots`.
- API: `/api/v1/addons/Sibyl.planning/participants`, `/slots`, `/generate`.
- Fairness: unabhängige Zählstände für Primär-, Sekundär- und Tertiärrotation; Doppelbelegung am selben Tag standardmäßig untersagt.
- Administrator-Konfiguration: `defaultDays`, `allowSameDayDoubleBooking`, `includeWeekends`.
- Rollen: Lesen für berechtigte Benutzer; Teilnehmerpflege und Planerzeugung nur für Administratoren.

Die Backend-Provider und die React-Seite liegen unter `Addons/Sibyl.planning/`. Sie werden in den bestehenden Sibyl-Core kompiliert. **Dies ist kein separat lauffähiges JAR und keine automatische GitHub-Installation.** Die erforderliche Datenbankmigration liegt im Core-Repository (`V7`).

Stand: Auf dem Entwicklungsserver kompiliert; Integration in die laufende Testumgebung und fachliche Abnahmetests stehen aus.
