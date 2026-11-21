# Tickets: Persönliche Budget-App

Nov 21, 2026 · @Alex

25 Tickets in 9 Epics aus dem PRD. Verbindlich sind die unten angegebenen Abhängigkeiten, nicht die Reihenfolge der Epics. Jedes Ticket ist ein eigener Agenten-Lauf und endet mit einem lauffähigen, getesteten Stand; spätere Funktionen dürfen dabei noch fehlen.

## Regeln für alle Tickets

- **Definition of Done:** Relevante Tests grün, neue Oberfläche durch tatsächliche Bedienabläufe bei 360 px und am Desktop geprüft (keine horizontale Seitenüberbreite, kein Hover-Zwang, mindestens 44 px große Tippflächen), README bei Bedarf ergänzt, keine Finanzdaten in Logs, keine externen Requests.
- **Beträge** immer als ganze Cent (Integer). Oberfläche deutsch, Format `1.234,56 €` und `TT.MM.JJJJ`.
- **CSV-Umfang:** Der konfigurierbare Generic-Parser ist der vollständige V1-Umfang. Reale anonymisierte Beispiel-CSVs sind hilfreich, aber kein Startblocker; synthetische Fixtures reichen für T-08. Feste Bankparser folgen erst nach V1.
- **Abhängigkeiten:** Tickets dürfen starten, sobald sämtliche genannten Voraussetzungen erfüllt sind. T-06 und T-08 können beispielsweise nach T-05 parallel bearbeitet werden, T-09 erst nach T-07 und T-08. Geteilte Dateien erfordern abgestimmte Integration; keine pauschale Parallelfreigabe ganzer Epics.
- **Fachlicher Vertrag:** Berechnungen, Erkennungsgrenzen, Bestätigungsregeln und Dateninvarianten des PRD sind verbindliche Akzeptanzkriterien. Änderungen daran müssen PRD und betroffene Tickets gemeinsam aktualisieren.

## Epic A: Fundament

### T-01 Projektgerüst

Ziel: Lauffähiges TypeScript/Node-Projekt mit SQLite.

- `npm start` startet den Server, `npm test` läuft, Lint und Formatierung sind eingerichtet.
- DB-Pfad ist konfigurierbar, Migrationen laufen automatisch beim Start.
- Framework-Wahl (Backend, Frontend, ORM) kurz in der README begründet.
- README-Grundgerüst: Setup, Konfiguration, Ordnerstruktur.

Abhängig von: nichts

### T-02 Passwort-Login

Ziel: Die ganze App ist passwortgeschützt.

- Einmalige Passwortvergabe atomar; nach Abschluss bleibt der Ersteinrichtungsendpunkt gesperrt. Login und Logout mit serverseitig invalidierbarer Session.
- Passwort nur als argon2- oder bcrypt-Hash gespeichert.
- Cookie `HttpOnly`, `SameSite=Strict`, bei HTTPS `Secure`; CSRF-Schutz für schreibende Aufrufe einschließlich Login/Ersteinrichtung. Session endet nach 30 Minuten Inaktivität; 5 fehlgeschlagene Logins je Quell-IP in 15 Minuten sperren diese bis Fensterende.
- Alle fachlichen Seiten/APIs geschützt. Öffentlich ausschließlich Login, einmalige Passwort-Ersteinrichtung und notwendige statische Ressourcen ohne Finanzdaten. Tests für unberechtigten Zugriff, parallele Ersteinrichtung, Logout, Timeout und Login-Sperre.
- Server bindet standardmäßig nur an `127.0.0.1`, die Bindung ist konfigurierbar.

Abhängig von: T-01

### T-03 Mobile-first App-Shell

Ziel: Rahmen der Oberfläche, auf dem alle weiteren Seiten aufbauen.

- Layout ab 360 px, Navigation am unteren Rand, Tippflächen mindestens 44 px.
- Hilfsfunktionen für deutsche Datums-, Zahlen- und Euro-Formatierung mit Tests.
- PWA-Manifest und Icons (installierbar, kein Offline-Betrieb).
- Test-Setup, das Seiten im mobilen Viewport prüft.

Abhängig von: T-02

### T-04 HTTPS im Heimnetz

Ziel: Handy-Zugriff über das WLAN zu Hause, sicher.

- Konfigurierbare Bindung an die lokale Netzwerkadresse, Standard bleibt `127.0.0.1`.
- Befehl erzeugt ein selbstsigniertes Zertifikat mit Subject Alternative Name für den konfigurierten Hostnamen beziehungsweise die IP. HTTPS ist bei Bindung außerhalb Loopback Pflicht; ohne ladbares, gültiges Schlüssel-/Zertifikatspaar verweigert der Server den Start.
- README-Anleitung: Zertifikat am Handy einmalig vertrauen, App aufrufen, zum Startbildschirm hinzufügen; keine öffentliche Internetfreigabe. Startverweigerung ohne TLS und HTTPS-Zugriff mit Secure-Session-Cookie prüfen.

Abhängig von: T-02, T-03

## Epic B: Konten und Kategorien

### T-05 Konten

Ziel: Mehrere Konten anlegen und verwalten.

- Anlegen, umbenennen, löschen (nur ohne Buchungen). Felder: Name, Typ (Giro, Tagesgeld, Kreditkarte, sonstiges).
- Tabelle `account`, mobile Verwaltungsseite.

Abhängig von: T-03

### T-06 Kategorien

Ziel: Kategorien mit Standardset.

- Beim ersten Start wird das Standardset angelegt (Wohnen, Lebensmittel, Mobilität, Versicherungen, Abos und Medien, Gesundheit, Freizeit, Kleidung, Sonstiges, Sparen, Einkommen, Umbuchung).
- Anlegen, umbenennen, löschen, Reihenfolge ändern. Flags: Einkommen, vom Budget ausgenommen, Übertrag aktiv.
- Löschen mit Referenzen erfordert eine kompatible Ersatzkategorie. Buchungen, Regeln, Budgets und wiederkehrende Fälligkeiten/Posten atomar umhängen; kollidierende Monatsbudgets addieren. Flagänderungen dürfen keine Budget-/Postenreferenz auf Einkommen oder ausgeschlossene Kategorien erzeugen.
- Einkommen und Ausschluss schließen sich gegenseitig aus; beide sind nicht budgetierbar und ohne Übertrag. Semantik anhand ID/Flags, nie anhand des Kategorienamens. Referenz- und Kollisionsfälle testen.

Abhängig von: T-03

### T-07 Buchungsmodell und Buchungsliste

Ziel: Buchungen anzeigen und kategorisieren.

- Tabelle `transaction` mit Konto, Datum, Betrag, Gegenpartei, Verwendungszweck, Kategorie, Herkunft (Regel/manuell, null ohne Kategorie), Importreferenz und Dedup-Feldern gemäß PRD. Konto ist Pflicht.
- Liste im Kartenlayout, stabil nach Datum und ID paginiert (50 Einträge je Seite), Filter: Monat, Konto, Kategorie, Text, nur nicht kategorisiert.
- Kategorie ändern in zwei Tipps (Buchung antippen, Kategorie wählen).
- Seed-Skript mit anonymisierten Testbuchungen für die Entwicklung.

Abhängig von: T-05, T-06

## Epic C: CSV-Import

### T-08 Parser-Interface und Generic-Parser

Ziel: CSV-Dateien einlesen, bankunabhängig konfigurierbar.

- Austauschbares Parser-Interface, ein Parser pro Bankformat.
- Generic-Parser: Trennzeichen, Encoding, Datumsformat, Dezimalformat und Spaltenzuordnung einstellbar.
- Import-Profil pro Konto speicher- und wiederverwendbar (Tabelle `import_profile`).
- Tests mit anonymisierten Fixture-Dateien, auch mit Format `1.234,56`.

Abhängig von: T-05

### T-09 Import-Ablauf und Duplikaterkennung

Ziel: CSVs mehrfach importieren, ohne Doppelbuchungen.

- Ablauf: Konto wählen, Datei hochladen, Vorschau der ersten Zeilen, Import bestätigen. Funktioniert vom Handy.
- Dedup-Hash aus Konto, Datum, Betrag, Gegenpartei und Verwendungszweck; pro Hash Vorkommen zählen. Neu = `max(0, Dateianzahl − Bestandsanzahl)`, eindeutig ist Hash plus Vorkommensnummer. Zählung und Schreiben atomar auch bei parallelen Importen.
- Akzeptanzfälle: Erstimport zweier identischer Buchungen erhält beide; überlappender Re-Import ergibt 0 neue; bei 2 vorhandenen und 3 Dateivorkommen entsteht genau 1 neue, danach 0. Anderes Konto bleibt unabhängig. Grenze nicht unterscheidbarer Einzelimporte in Importhilfe erklären.
- Zusammenfassung: neu, übersprungen, nicht kategorisiert. Tabelle `import`.

Abhängig von: T-07, T-08

### T-10 Import-Robustheit

Ziel: Fehlerhafte Dateien richten keinen Schaden an.

- Import läuft in einer Datenbank-Transaktion, bei Fehler wird komplett zurückgerollt.
- Verständliche Fehlermeldungen: leere Datei, falsches Trennzeichen, unlesbares Datum, fehlende Spalte, mit Zeilennummer.
- Tests für jeden Fehlerfall.

Abhängig von: T-09

## Epic D: Regeln

### T-11 Regel-Engine

Ziel: Importierte Buchungen automatisch kategorisieren.

- Regel: Suchtext (enthält, Groß/Kleinschreibung egal), Feld (Gegenpartei, Verwendungszweck oder beide), Zielkategorie, Priorität.
- Kleinere Prioritätszahl gewinnt, Gleichstand nach kleinerer stabiler Regel-ID. „Beide“ bedeutet Treffer in mindestens einem der separat geprüften Felder; leere Suchtexte unzulässig.
- Wird beim Import angewendet. Manuell gesetzte Kategorien werden nie überschrieben.
- Tests für Prioritäten, Konflikte und „keine Regel passt“.

Abhängig von: T-07, T-09

### T-12 Regeln-Oberfläche

Ziel: Regeln bequem pflegen.

- Regeln anlegen, bearbeiten, löschen, sortieren, mobil bedienbar.
- Beim manuellen Korrigieren einer Buchung: Angebot „Regel daraus erstellen“.
- Regeln auf bestehende, nicht manuell kategorisierte Buchungen anwenden, mit Vorschau der Änderungen.

Abhängig von: T-11

## Epic E: Budget und Einkommen

### T-13 Monatsbudget

Ziel: Pro Monat und Kategorie ein Budget planen.

- Tabelle `budget`, Budgetmonat = Kalendermonat.
- Bearbeitungsseite für das Budget, mobil bedienbar. Neuer Monat wird aus dem Vormonat vorbelegt.
- Einkommen und vom Budget ausgeschlossene Kategorien erscheinen nicht. Ausgaben, Rest und Fortschritt folgen PRD 4.3: negative Buchungen als positive Ausgaben, positive Buchungen normaler Kategorien ohne Gegenrechnung; globale Ausgabensumme einschließlich negativer nicht kategorisierter Buchungen.

Abhängig von: T-06, T-09

### T-14 Einkommen und „noch nicht verplant“

Ziel: Planungsbasis und freier Betrag.

- Einkommen = Summe ausschließlich positiver Buchungen in Einkommen-Kategorien des betrachteten Monats, über alle Konten. Negative/Nullbuchungen sind kein Einkommen.
- Ohne positiven Einkommenseingang gilt ausschließlich das tatsächliche Einkommen des unmittelbaren Vormonats, ohne rekursiven Rückgriff; fehlt es, ist die Basis 0. Nach erstem positiven Eingang gilt das tatsächliche Monatseinkommen.
- Anzeige „Vormonat (Annahme)“ oder „tatsächlich“, gegebenenfalls „keine Basis vorhanden“. „Noch nicht verplant“ = Planungsbasis minus Summe aller Budgets.
- Unit-Tests für ersten Monat ohne Historie, negativen/Nullbetrag, ersten positiven Eingang, Monats-/Jahreswechsel und Monatsnavigation.

Abhängig von: T-13, T-09

### T-15 Übertrag pro Kategorie

Ziel: Nicht ausgegebenes Budget in den nächsten Monat mitnehmen.

- `verfügbar = Monatsbudget + Übertrag`, `Rest = verfügbar − Ausgaben`. Übertrag ist bei aktiviertem Schalter der Vormonatsrest, auch negativ, sonst 0; Beginn beim frühesten Budget-/Buchungsmonat mit Übertrag 0.
- Fehlende Monate und Budgets rekursiv gemäß PRD 4.3 fortführen, gespeicherte Budgets nicht überschreiben. Rückwirkende Änderungen berechnen Folgereste neu. Schalter wirkt auf gesamte Historie; UI erklärt die Rückwirkung vor Bestätigung.
- Tests über mehrere Monate/Jahreswechsel, fehlende Monate, negativen Rest, rückwirkende Buchung und Umschalten.

Abhängig von: T-13, T-09

### T-16 Umbuchungen zwischen Konten

Ziel: Interne Überweisungen verfälschen Einkommen und Ausgaben nicht.

- Erkennung gegengleicher Buchungen auf zwei verschiedenen Konten: gleicher Betrag, umgekehrtes Vorzeichen, höchstens 3 Tage Abstand.
- Vorschlagsliste, Bestätigung je Paar oder konfliktfreier Auswahl. Keine automatische Paarwahl bei Mehrdeutigkeit; jede Buchung höchstens in einem Paar. Dauerhafte Tabelle `transfer_pair`, atomare, rücknehmbare Bestätigung und manuelle Kategorieherkunft. Nach Löschen von „Umbuchung“ ausgeschlossene Zielkategorie wählen, nicht anhand des Namens suchen.
- Kreditkarte: die Sammelabbuchung vom Girokonto ist eine Umbuchung, die Einzelbuchungen auf der Kreditkarte zählen als Ausgaben.
- Umbuchungen fließen weder in Einkommen noch in Ausgaben ein.

Abhängig von: T-09, T-14

## Epic F: Wiederkehrende Posten

### T-17 Wiederkehrende Posten verwalten

Ziel: Feste Kosten separat erfassen und vorplanen.

- Felder: Name, positiver Centbetrag, Intervall (monatlich/vierteljährlich/jährlich), erste Fälligkeit als vollständiges Datum, budgetierbare Kategorie, Gegenpartei-Hinweis. Tabellen `recurring_item` und `recurring_occurrence` mit eindeutigem Termin pro Posten.
- Folgetermine vom ursprünglichen Datum ableiten; fehlender Monatstag fällt auf Monatsende, ohne spätere Termine zu verschieben. Tests für den 31. und den 29. Februar sowie Quartals-/Jahresintervalle.
- Offene Fälligkeiten reservieren innerhalb des Budgets, erhöhen es nicht: „offen geplant“ sowie „nach offenen Posten frei = Rest − offene Reservierungen“. Kein zusätzlicher Ausgabenabzug und keine erneute Reservierung überfälliger Posten im Folgemonat.

Abhängig von: T-13, T-15

### T-18 Abgleich mit Buchungen

Ziel: Erkennen, ob ein fester Posten bezahlt wurde.

- Vorschläge beim Import und für vorhandene Buchungen: negative Buchung, Gegenpartei/Hinweis nach Großschreibung und Leerzeichen-Normalisierung identisch, Betrag maximal 5 % vom Soll, Datum maximal 7 Kalendertage von der Fälligkeit entfernt. Leerer Hinweis liefert keine Vorschläge; Mehrdeutigkeit entscheidet der Nutzer.
- Dauerhafte, rücknehmbare Eins-zu-eins-Zuordnung zwischen Buchung und Fälligkeit; Umbuchungen ausgeschlossen. Kategorie nur mit ausdrücklicher Zustimmung setzen. Bestätigte Fälligkeiten behalten ihren Sollstand bei späteren Postenänderungen.
- Status „bezahlt“/„offen“ pro Fälligkeit sichtbar. Nach Bestätigung entfällt nur die Reservierung; die Buchung zählt genau einmal im Buchungsmonat als Ausgabe. Tests für Mehrfachzuordnung, Grenztoleranzen, Rücknahme und Zahlung in benachbartem Monat.

Abhängig von: T-17, T-09, T-16

## Epic G: Dashboard

### T-19 Dashboard aktueller Monat

Ziel: Budget gegen Ist auf einen Blick, am Handy.

- Kompakte Kopfzeile: Einkommen (tatsächlich oder Vormonat), Summe Budgets, noch nicht verplant, Summe Ausgaben, Anzahl nicht kategorisierter Buchungen mit Link zur Liste.
- Eine Karte pro Kategorie: Budget, ausgegeben, Rest inklusive Übertrag, Fortschrittsbalken, farbliche Markierung bei Überschreitung.
- Kontofilter (Standard alle) und Monatsnavigation. Budget, Planungsbasis, Übertrag, Rest und globale Summen bleiben kontoübergreifend; zusätzlich klar beschriftete Ausgaben/Nicht-kategorisiert-Anzahl des ausgewählten Kontos. Kein scheinbar kontospezifischer Budgetrest.
- Einspaltig und ohne Hover-Funktionen. Keine Trend-Diagramme in V1.

Abhängig von: T-14, T-15, T-16, T-18

## Epic H: Einrichtungs-Assistent

### T-20 Assistent-Gerüst

Ziel: Geführte Ersteinrichtung.

- Schrittfolge mit Fortschrittsanzeige, ein Schritt pro Bildschirm: Konten anlegen, Historie pro Konto importieren, danach die Schritte aus T-21 bis T-23.
- Jederzeit unterbrechbar und persistent fortsetzbar, später erneut aufrufbar. Bestätigte Aktionen referenzieren statt doppelt ausführen; Wiederaufnahme darf keine Regeln/Posten duplizieren oder manuelle Kategorien überschreiben. Schreibgrenzen gemäß PRD 4.0.1.
- Nutzt die vorhandenen Funktionen aus T-05, T-08 und T-09.

Abhängig von: T-09, T-19

### T-21 Gruppierung nach Gegenpartei

Ziel: Mit wenigen Tipps hunderte Buchungen kategorisieren.

- Gegenparteien werden normalisiert (Großschreibung, Filialnummern, Datumsreste entfernt) und gruppiert, sortiert nach Summe und Häufigkeit.
- Erst ausdrückliche Gruppenbestätigung speichert manuelle Zuordnungen der ausgewählten, nicht bereits manuell kategorisierten Buchungen und eine passende Regel (T-11) atomar. Regelvorschau muss die tatsächlichen Treffer ihrer Suchbedingung zeigen; Normalisierungsheuristik darf keine abweichende Regelwirkung verbergen. Gruppen dürfen übersprungen werden.
- Eingebautes Wörterbuch bekannter deutscher Händler und Anbieter (Datei, gut erweiterbar) liefert Kategorievorschläge. Rein lokal.
- Tests für die Normalisierung mit realistischen, anonymisierten Beispielen.

Abhängig von: T-11, T-20

### T-22 Erkennung von Einkommen und festen Kosten

Ziel: Vorschläge für Einkommen und wiederkehrende Posten aus der Historie.

- Einkommen: positive Eingänge derselben normalisierten Gegenpartei von jeweils mindestens 100,00 € in mindestens 2 verschiedenen Kalendermonaten. Heuristik schränkt manuelle Einkommenskategorisierung nicht ein.
- Feste Kosten: negative Buchungen derselben normalisierten Gegenpartei in mindestens 2 Kalendermonaten, Betragsabsolutwerte jeweils höchstens 5 % vom Median entfernt. Centgerundeter Median und jüngstes passendes Datum als editierbarer Betrag/erste Fälligkeit. Nur monatliche Vorschläge; Quartals-/Jahresposten manuell.
- Vorschläge ausdrücklich bestätigen/verwerfen; erst dann Posten anlegen beziehungsweise Einkommen manuell kategorisieren. Bereits manuelle Zuordnungen bleiben unverändert; keine Doppelanlage beim Fortsetzen. Tests für Schwellen und Monatsgrenzen.
- Umbuchungsvorschläge aus T-16 werden im selben Schritt angezeigt.

Abhängig von: T-16, T-17, T-20

### T-23 Start-Budget und Abschluss

Ziel: Aus der Historie ein erstes Budget machen.

- Gemeinsamen Zeitraum vollständiger Kalendermonate und Vollständigkeit der Historie aller einbezogenen Konten bestätigen lassen. Budgetvorschlag je budgetierbarer Kategorie = Ausgaben im Zeitraum / Monatsanzahl, inklusive Nullmonaten, kaufmännisch auf Cent gerundet; Einkommen/Umbuchungen ausgeschlossen. Teilmonate ausgeschlossen, ohne vollständigen Monat manuelle Eingabe.
- Anpassbare Vorschau erst mit „Budget übernehmen“ speichern, vorhandene Monatsbudgets nur mit zusätzlicher Ersetzungsbestätigung. Planungsbasis folgt T-14, kein separates geschätztes Einkommen.
- Abschlussbildschirm: Anzahl Buchungen, Kategorien, Regeln, erkannte Einkommen und feste Posten, noch nicht kategorisierte Buchungen.
- Danach landet der Nutzer im Dashboard.

Abhängig von: T-13, T-14, T-21, T-22

## Epic I: Abschluss

### T-24 Dokumentation

Ziel: Der Nutzer kann die App ohne Hilfe betreiben.

- README: Installation, Konfiguration, Heimnetz-Zugriff mit passendem Zertifikat, sichere Session-Einstellungen und konsistentes Backup/Wiederherstellung gemäß PRD 4.10. App stoppen, Checkpoint/Journalzustand sicherstellen; bei verbliebener WAL nicht nur die Hauptdatei kopieren. Restore bei gestoppter App ohne Vermischung alter Journaldateien.
- Anleitung „Neuen Bank-Parser hinzufügen“ mit Beispiel.

Abhängig von: T-04, T-23

### T-25 Qualitätssicherung

Ziel: Hauptpfad und Leistung abgesichert.

- End-to-End-Bedienablauf bei 360 px und am Desktop: Login, Assistent samt Unterbrechen/Fortsetzen, Import/Re-Import, Kategorisierung, Budget, Dashboard; keine horizontale Seitenüberbreite, Touchziele und Zwei-Tipp-Kategorieänderung prüfen.
- Performance nach PRD 6: 50.000 synthetische Buchungen über 5 Jahre/4 Konten, p95 ≤ 500 ms für Dashboard-Monatsabfrage und gefilterte 50er-Buchungsseite bei je 30 warmen lokalen API-Aufrufen; Darstellung nach Antwort ≤ 1 s in Chromium bei 360 px ohne Drosselung. Linux mit mindestens 2 Kernen/4 GiB RAM/lokaler SSD ohne parallele Last; Hardware, Software, Filter und Messwerte dokumentieren.
- Datenschutz-Check: keine Finanzdaten in Logs, keine externen Requests (automatisierter Test).

Abhängig von: T-04, T-10, T-12, T-18, T-23
