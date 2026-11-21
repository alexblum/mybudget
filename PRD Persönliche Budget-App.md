# PRD: Persönliche Budget-App

Entwurf vom 21.11.2026 · Zielgruppe: Coding-Agent, der die App implementiert

## 1. Ziel und Problem

Der Nutzer will seine Finanzen in den Griff bekommen. Das Hauptproblem: **ein Budget planen und einhalten**. Die App importiert Kontoumsätze per CSV, ordnet sie automatisch Kategorien zu und zeigt jederzeit, wie viel pro Kategorie im laufenden Monat budgetiert, ausgegeben und noch übrig ist.

## 2. Rahmenbedingungen

- **Nutzer:** genau eine Person (Single-User), kein Mehrbenutzerbetrieb.
- **Plattform:** Web-App im Browser, mobile-first und bequem am Handy bedienbar (siehe 6.1).
- **Betrieb:** vollständig selbst gehostet auf dem eigenen Rechner. Finanzdaten bleiben auf dem Rechner und den bewusst verbundenen Browsern im Heimnetz. Keine Cloud, keine externen Dienste, keine Telemetrie.
- **Konten:** mehrere Konten (z. B. Girokonto, Tagesgeld, Kreditkarte), jede Buchung ist einem Konto zugeordnet (siehe 4.0).
- **Sprache der Oberfläche:** Deutsch. Datum `TT.MM.JJJJ`, Zahlen `1.234,56`, Währung EUR.
- **Tech-Stack:** TypeScript, Node.js, SQLite. Konkrete Frameworks wählt der Agent (leichtgewichtig, wenig Abhängigkeiten, Begründung in der README).

## 3. Nicht-Ziele für V1

- Depot, Investments, Schulden-Tracking
- Sparziele mit Betrag und Datum
- Automatische Bankanbindung (FinTS/PSD2)
- Mehrbenutzer, Rollen, Cloud-Sync, native mobile App (die Web-App selbst ist mobil nutzbar)
- Verlaufs-/Trend-Auswertungen über mehrere Monate und Warnungen bei Überschreitung (siehe Ausbaustufen)
- Automatische Backups (Backup = SQLite-Datei, der Nutzer sichert selbst)

## 4. Funktionale Anforderungen

### 4.0 Konten

- Mehrere Konten möglich (z. B. Girokonto, Tagesgeld, Kreditkarte). Pro Konto: Name und Typ.
- Jede Buchung gehört zu genau einem Konto. Das Konto wird beim Import gewählt und an der Buchung vermerkt.
- **Budget konto-übergreifend (Annahme):** Es gibt ein Monatsbudget pro Kategorie über alle Konten hinweg, nicht je Konto.
- Buchungsliste und Dashboard haben einen Kontofilter, Standard ist „alle Konten“.
- **Dashboard-Kontofilter:** Budget, Einkommen/Planungsbasis, Übertrag, Rest und globale Ausgabensummen bleiben kontoübergreifend. Bei ausgewähltem Konto erscheinen zusätzlich dessen Ausgaben und Anzahl nicht kategorisierter Buchungen, ausdrücklich als Kontowerte beschriftet. Die Buchungsliste filtert dagegen ihre Buchungen tatsächlich nach Konto.
- **Umbuchungen zwischen eigenen Konten (Annahme):** Gegengleiche Buchungen auf zwei verschiedenen Konten (gleicher Betrag, umgekehrtes Vorzeichen, höchstens 3 Tage Abstand) erkennt die App und schlägt vor, beide als „Umbuchung“ zu markieren. Sie zählen weder als Einkommen noch als Ausgabe.
- **Kreditkarte (Annahme):** Die Sammelabbuchung der Kreditkartenabrechnung vom Girokonto ist eine Umbuchung. Die Einzelbuchungen auf der Kreditkarte zählen als Ausgaben.
- Eine Buchung darf höchstens einem bestätigten Umbuchungspaar angehören. Bei mehreren Kandidaten entscheidet der Nutzer; es wird kein Paar automatisch festgeschrieben. Bestätigung und Aufhebung eines Paars erfolgen atomar und gelten als manuelle Kategorisierung. Ist die Kategorie „Umbuchung“ gelöscht, muss vor einer Bestätigung eine ausgeschlossene, nicht als Einkommen markierte Zielkategorie gewählt werden.

### 4.0.1 Einrichtungs-Assistent (erster Start)

Beim ersten Start führt ein Assistent durch die Einrichtung. Er ist später erneut aufrufbar, z. B. wenn ein neues Konto dazukommt. Alle Auswertungen laufen lokal, ohne Cloud und ohne externe KI.

1. **Konten anlegen.**
2. **Historie importieren:** Pro Konto etwa 3 Monate Buchungen (Empfehlung, keine harte Grenze). Dabei wird die Spaltenzuordnung festgelegt und als Import-Profil des Kontos gespeichert.
3. **Nach Gegenpartei gruppieren:** Buchungen werden nach normalisierter Gegenpartei gebündelt (z. B. alle „REWE“-Buchungen), sortiert nach Summe und Häufigkeit. Der Nutzer ordnet pro Gruppe einmal eine Kategorie zu, daraus entstehen automatisch Regeln. Vorschläge kommen aus einem eingebauten Wörterbuch bekannter deutscher Händler und Anbieter. Gruppen dürfen übersprungen werden und bleiben „nicht kategorisiert“.
4. **Einkommen erkennen:** Positive Eingänge derselben normalisierten Gegenpartei von jeweils mindestens 100,00 € in mindestens 2 verschiedenen Kalendermonaten werden als Einkommen vorgeschlagen. Der Nutzer bestätigt; dies ist eine Vorschlagsheuristik, keine Einschränkung manueller Einkommenszuordnung.
5. **Feste Kosten erkennen:** Negative Buchungen derselben normalisierten Gegenpartei in mindestens 2 verschiedenen Kalendermonaten werden als monatliche Posten vorgeschlagen, wenn alle Betragsabsolutwerte höchstens 5 % vom Median abweichen. Vorgeschlagener Betrag ist der auf ganze Cent kaufmännisch gerundete Median, erste Fälligkeit das jüngste passende Buchungsdatum; beides ist vor Bestätigung änderbar. Vierteljährliche und jährliche Posten werden manuell angelegt.
6. **Umbuchungen erkennen:** siehe 4.0.
7. **Start-Budget vorschlagen:** Der Nutzer bestätigt einen gemeinsamen Auswertungszeitraum ganzer Kalendermonate für alle einbezogenen Konten und bestätigt, dass deren Historie vollständig ist. Teilmonate bleiben ausgeschlossen; ohne vollständigen Monat wird das Budget manuell eingegeben. Pro budgetierbarer Kategorie wird die Summe der Ausgaben durch die Anzahl dieser Monate geteilt, inklusive Monaten ohne Ausgaben, und kaufmännisch auf ganze Cent gerundet. Einkommen und ausgeschlossene Kategorien bleiben außen vor. Das Ergebnis ist anpassbar; die Planungsbasis folgt ausschließlich 4.4.
8. **Zusammenfassung:** Anzahl Buchungen, Kategorien, Regeln, erkannte Einkommen und feste Posten, noch nicht kategorisierte Buchungen.

Alle Ergebnisse sind Vorschläge. Erst die ausdrücklich bestätigte Aktion speichert Konten, Import/Profile, Gruppenzuordnungen samt Regeln, erkannte Posten oder Umbuchungspaare. Budgetvorschläge werden erst mit „Budget übernehmen“ gespeichert; bestehende Monatsbudgets werden nur nach ausdrücklicher Ersetzungsbestätigung überschrieben. Fortschritt und bereits bestätigte Aktionen werden persistent gespeichert; Fortsetzen oder erneuter Aufruf erzeugt keine doppelten Regeln/Posten und überschreibt keine manuellen Zuordnungen. Gruppenbestätigungen gelten als manuelle Zuordnung der ausgewählten Buchungen, die erzeugte Regel gilt für künftige beziehungsweise ausdrücklich neu ausgewertete Buchungen. Ein lokales Sprachmodell wäre eine mögliche spätere Erweiterung.

### 4.1 CSV-Import

- Der Nutzer wählt das Zielkonto und lädt die CSV-Datei der zugehörigen Bank hoch.
- **Bank und Format sind noch offen.** Der Import wird deshalb über ein austauschbares Parser-Interface gebaut (ein Parser pro Bankformat). In V1 gibt es einen konfigurierbaren Generic-Parser: Trennzeichen, Encoding, Datumsformat, Dezimalformat und Spaltenzuordnung sind einstellbar und werden gespeichert.
- Pflichtfelder pro Buchung: Buchungsdatum, Betrag (positiv = Eingang, negativ = Ausgang), Gegenpartei, Verwendungszweck.
- **Duplikate:** Der Nutzer importiert mehrfach mit überlappenden Zeiträumen. Die App erkennt bereits vorhandene Buchungen automatisch und überspringt sie. Erkennung über einen deterministischen Hash aus Konto, Datum, Betrag, Gegenpartei und Verwendungszweck. Bei mehreren identischen Buchungen am selben Tag innerhalb einer Datei zählt die Anzahl, damit echte Doppelbuchungen nicht verloren gehen.
- Pro Hash werden vorhandene und in der Datei enthaltene Vorkommen gezählt: neu = `max(0, Dateianzahl − Bestandsanzahl)`. Zwei vorhandene identische Buchungen und drei in der Datei ergeben genau eine neue; erneuter Import ergibt null neue. Der Hash allein ist nicht eindeutig. Zählung und Schreiben erfolgen atomar, auch bei parallelen Importen. Identische reale Buchungen, die nie gemeinsam in einer Datei vorkommen, sind anhand dieser Felder nicht unterscheidbar; diese Grenze wird in der Importhilfe genannt.
- Nach dem Import erscheint eine Zusammenfassung: neu importiert, übersprungen (Duplikate), nicht kategorisiert.

### 4.2 Kategorisierung

- Beim ersten Start gibt es ein **vorgefertigtes Standardset an Kategorien** (Annahme: Wohnen, Lebensmittel, Mobilität, Versicherungen, Abos und Medien, Gesundheit, Freizeit, Kleidung, Sonstiges, Sparen, Einkommen, Umbuchung). Alle Kategorien sind umbenenn-, lösch- und ergänzbar.
- **Regelbasiert:** Regeln ordnen Buchungen automatisch zu, z. B. Gegenpartei enthält „REWE“ → Lebensmittel. Eine Regel besteht aus Suchtext (enthält, Groß/Kleinschreibung egal) auf Gegenpartei und/oder Verwendungszweck, Zielkategorie und Priorität.
- Kleinere Prioritätszahl gewinnt, bei Gleichstand die kleinere stabile Regel-ID. Feld „beide“ bedeutet Treffer in Gegenpartei **oder** Verwendungszweck, jeweils separat geprüft; leere Suchtexte sind unzulässig.
- Der Nutzer kann jede Zuordnung manuell korrigieren. Beim Korrigieren bietet die App an, daraus eine Regel zu erstellen.
- Nicht zugeordnete Buchungen landen in „Nicht kategorisiert“ und sind prominent sichtbar.
- Neue oder geänderte Regeln können auf bestehende, nicht manuell zugeordnete Buchungen angewendet werden. Manuell gesetzte Kategorien werden nie von Regeln überschrieben.
- Kategorien werden anhand ihrer ID/Flags, nie ihres Namens ausgewertet. `is_income` und `is_excluded` schließen sich gegenseitig aus; beide Kategoriearten sind nicht budgetierbar und haben keinen Übertrag. Löschen mit Referenzen erfordert eine kompatible Ersatzkategorie: Buchungen, Regeln, wiederkehrende Posten und Budgets werden atomar umgehängt. Bei Budgetkollisionen im selben Monat werden Beträge addiert. Budget- und Postenreferenzen dürfen nur auf budgetierbare Kategorien zeigen; auch Flagänderungen müssen diese Invariante erhalten.

### 4.3 Budget

- **Modell:** Monatsbudget pro Kategorie mit Zero-Based-Anzeige (Arbeitsannahme, jederzeit änderbar).
- Pro Monat und Kategorie ein Budgetbetrag.
- Die App zeigt oben **„noch nicht verplant“** = Planungsbasis-Einkommen minus Summe aller Budgets. Der Nutzer kann auf 0 planen, muss aber nicht.
- **Budgetmonat = Kalendermonat** (1. bis Monatsende).
- **Übertrag:** Nicht ausgegebenes Budget kann pro Kategorie in den nächsten Monat wandern. Der Übertrag ist pro Kategorie ein-/ausschaltbar. Überzogene Beträge (negativer Rest) werden nur übertragen, wenn der Übertrag für die Kategorie aktiv ist.
- Neuer Monat: Budgets werden aus dem Vormonat vorbelegt und sind änderbar.
- **Berechnung:** Ausgaben sind Betragsabsolutwerte negativer Buchungen in budgetierbaren Kategorien; positive Buchungen dort mindern in V1 keine Ausgaben und sind kein Einkommen. Die globale Ausgabensumme enthält zusätzlich negative nicht kategorisierte Buchungen, damit diese nicht unsichtbar werden. Einkommen und ausgeschlossene Kategorien zählen nicht als Ausgaben.
- `verfügbar = Monatsbudget + Übertrag`, `Rest = verfügbar − Ausgaben`. Einkommen und ausgeschlossene Kategorien erhalten kein Budget. Offene feste Posten werden separat reserviert (siehe 4.5), verändern aber den Rest nicht.
- **Übertragskette:** Beginn ist der früheste Monat mit Budget oder Buchung der Kategorie, anfänglicher Übertrag ist 0. Jeder folgende Kalendermonat übernimmt bei aktivem Übertrag den Rest seines Vormonats, sonst 0. Fehlende Monatsbudgets übernehmen rekursiv die Beträge des Vormonats (vor dem ersten Budget 0); gespeicherte Monatsbudgets werden nie still überschrieben. Rückwirkende Buchungen/Budgetänderungen berechnen alle Folgereste neu. Der aktuelle Übertragsschalter gilt für die gesamte Historie; Umschalten wirkt rückwirkend und wird vor Bestätigung erklärt.

### 4.4 Einkommen

- Einkommen ist die Summe ausschließlich positiver Buchungen in Kategorien mit `is_income`, über alle Konten. Negative oder Nullbuchungen dieser Kategorien reduzieren es nicht und lösen keinen Wechsel auf „tatsächlich“ aus.
- **Planung vor Gehaltseingang:** Ohne positiven Einkommenseingang im betrachteten Monat gilt das tatsächliche Einkommen des unmittelbaren Vormonats, ohne rekursiven Rückgriff auf frühere Annahmen. Fehlt dort Einkommen, ist die Planungsbasis 0. Sobald ein positiver Einkommenseingang vorliegt, zählt das tatsächliche Einkommen des betrachteten Monats.
- Die UI kennzeichnet „Vormonat (Annahme)“ oder „tatsächlich“, bei fehlendem Vormonatseinkommen zusätzlich „keine Basis vorhanden“. Dies gilt auch bei Monatsnavigation.

### 4.5 Wiederkehrende Kosten

- Feste Posten werden separat erfasst: Name, positiver Betrag in Cent, Intervall (monatlich, vierteljährlich, jährlich), erste Fälligkeit als vollständiges Datum, budgetierbare Kategorie und Gegenpartei-Hinweis. Folgetermine ergeben sich mit 1/3/12 Monaten Abstand vom ursprünglichen Datum; fehlt dessen Tag im Zielmonat, gilt der letzte Monatstag, ohne die spätere Terminfolge zu verschieben.
- Jeder Fälligkeitstermin ist ein eigener Vorgang. Offene Fälligkeiten reservieren ihren Betrag innerhalb des Kategorienbudgets, erhöhen es aber nicht. Anzeige: „offen geplant“ und `nach offenen Posten frei = Rest − offene Reservierungen`. Bei bestätigter Zahlung entfällt die Reservierung; nur die importierte Buchung zählt als Ausgabe in ihrem Buchungsmonat. Nicht bezahlte Fälligkeiten bleiben ihrem Fälligkeitsmonat zugeordnet und als offen sichtbar; keine zweite Reservierung in Folgemonaten.
- Zahlungsabgleich ist ausschließlich ein bestätigter Vorschlag: negative Buchung, normalisierte Gegenpartei entspricht dem normalisierten Gegenpartei-Hinweis (Großschreibung, äußere Leerzeichen entfernen, innere Leerzeichen zusammenfassen), Betrag höchstens 5 % vom Soll entfernt und Buchungsdatum höchstens 7 Kalendertage von der Fälligkeit entfernt. Leerer Hinweis erzeugt keine Vorschläge. Bei Mehrdeutigkeit entscheidet der Nutzer. Eine Buchung erfüllt höchstens eine Fälligkeit und eine Fälligkeit erhält höchstens eine Buchung; Umbuchungen sind ausgeschlossen. Bestätigung speichert die Zuordnung dauerhaft, setzt die passende Kategorie nur nach ausdrücklicher Zustimmung und ist rücknehmbar. Änderungen an Posten wirken nur auf noch nicht bestätigte Fälligkeiten; bestätigte behalten ihren gespeicherten Sollstand. Keine automatische Anlage neuer Abos außerhalb bestätigter Assistentenvorschläge.

### 4.6 Dashboard (V1)

- Zeigt standardmäßig den aktuellen Monat: Budget vs. Ist; vergangene Monate sind in derselben Ansicht aufrufbar.
- Pro Kategorie: Budget, ausgegeben, Rest (inklusive Übertrag), Fortschrittsbalken. Kategorien über Budget sind farblich markiert.
- Kopfzeile: Einkommen (tatsächlich oder Vormonats-Annahme), Summe Budgets, „noch nicht verplant“, Summe Ausgaben, Anzahl nicht kategorisierter Buchungen.
- Annahme: Monatsnavigation (Vor/Zurück) ist erlaubt, um vergangene Monate in derselben Ansicht zu betrachten. Es gibt keine separaten Trend-Diagramme.

### 4.7 Buchungsliste

- Durchsuchbare, filterbare Liste (Monat, Konto, Kategorie, Text, nur nicht kategorisiert).
- Kategorie pro Buchung direkt änderbar.

### 4.8 Umbuchungen und Sonderfälle (Annahmen)

- Splits (eine Buchung auf mehrere Kategorien) und Erstattungen als Gegenbuchung sind in V1 nicht vorgesehen.
- Die Kategorie „Umbuchung“ ist vom Budget und vom Einkommen ausgenommen (z. B. Übertrag aufs Tagesgeldkonto).

### 4.9 Sicherheit

- **Passwortschutz** für die gesamte App: Passwort beim ersten Start setzen, danach Login mit Session.
- Öffentlich sind ausschließlich Ersteinrichtung vor gesetztem Passwort, Login und notwendige statische Ressourcen ohne Finanzdaten. Die erstmalige Passwortvergabe wird atomar genau einmal abgeschlossen; danach ist der Einrichtungsendpunkt gesperrt. Alle fachlichen APIs und Seiten erfordern eine Session.
- Session-Cookie: `HttpOnly`, `SameSite=Strict`, bei HTTPS zusätzlich `Secure`; schreibende Aufrufe einschließlich Login/Ersteinrichtung haben CSRF-Schutz. Logout invalidiert die Session serverseitig. Nach 30 Minuten Inaktivität läuft sie ab. Nach 5 fehlgeschlagenen Login-Versuchen je Quell-IP innerhalb von 15 Minuten sind weitere Versuche dieser IP bis zum Ablauf des Fensters gesperrt.
- Passwort nur als starker Hash speichern (argon2 oder bcrypt), keine Klartext-Speicherung.
- Server bindet standardmäßig nur an `127.0.0.1`.
- Keine Finanzdaten in Logs. Keine externen Requests (keine CDNs, Fonts oder Analytics von Dritten).

### 4.10 Backup und Export

- Dauerhafte Fachdaten und Einstellungen liegen in einer SQLite-Datenbank an einem dokumentierten, konfigurierbaren Pfad; im laufenden Betrieb darf SQLite zusätzliche Journal-/WAL-Dateien führen. Der Nutzer sichert selbst, kein eigener Export-Dialog in V1.
- Die README beschreibt konsistentes Backup und Wiederherstellung: App vollständig stoppen, erfolgreichen Checkpoint beziehungsweise vollständig zurückgeschriebenen Journalzustand sicherstellen, dann die Datenbank kopieren. Bei verbliebener WAL-Datei nicht nur die Hauptdatei kopieren. Wiederherstellung bei gestoppter App; vorhandenen Datenbestand vorher sichern und keine alten Journaldateien mit einer anderen Datenbank mischen.

## 5. Datenmodell (grob)

- `account`: id, name, type (Giro, Tagesgeld, Kreditkarte, sonstiges). Verknüpft mit `transaction.account_id` und `import_profile.account_id`; der Dedup-Hash einer Buchung enthält die Konto-ID.

* `transaction`: id, account_id, booking_date, amount_cents (Integer), counterparty, purpose, category_id (nullable), category_source (rule/manual oder null ohne Kategorie), import_id, dedup_hash, dedup_occurrence; eindeutig ist (dedup_hash, dedup_occurrence), nicht der Hash allein
* `category`: id, name, sort_order, carryover_enabled, is_income, is_excluded; Flags und Referenzregeln gemäß 4.2
* `rule`: id, match\_text, match\_field (counterparty/purpose/both), category\_id, priority
* `budget`: id, month (YYYY-MM), category\_id, amount\_cents
* `recurring_item`: id, name, amount_cents, interval, first_due_date, category_id, counterparty_hint
* `recurring_occurrence`: id, recurring_item_id, due_date, amount_cents, category_id, matched_transaction_id (nullable, eindeutig); eindeutig pro Posten und Fälligkeitsdatum, bestätigter Sollstand bleibt gespeichert
* `transfer_pair`: id, outgoing_transaction_id, incoming_transaction_id; jede Buchung höchstens in einem Paar
* `setup_progress`: persistenter Assistentenfortschritt und Referenzen auf bestätigte Aktionen für idempotente Wiederaufnahme
* `import`: id, filename, imported\_at, parser\_id, rows\_new, rows\_skipped
* `import_profile`: id, account_id, name, delimiter, encoding, date_format, decimal_format, column_mapping
* `settings`: password\_hash, db-weite Einstellungen

Beträge immer als ganze Cent (Integer), nie als Fließkomma.

## 6. Nicht-funktionale Anforderungen

- Start mit einem Befehl (z. B. `npm start`), keine zusätzliche Infrastruktur.
- Leistung mit 50.000 synthetischen Buchungen über 5 Jahre und 4 Konten: Dashboard-Monatsabfrage sowie gefilterte, nach Datum und ID stabil paginierte Buchungsliste (50 Einträge je Seite) jeweils p95 höchstens 500 ms bei 30 warmen lokalen API-Aufrufen. Referenz: Linux, mindestens 2 CPU-Kerne, 4 GiB RAM, lokale SSD, keine parallele Last; konkrete Hardware/Software und Ergebnisse dokumentieren. Browserdarstellung nach Antwort höchstens 1 s im Chromium-Test bei 360 px ohne CPU-/Netzwerkdrosselung.
- Tests für Import-Parser (mit anonymisierten Fixture-Dateien), Duplikaterkennung, Regel-Engine und Budgetberechnung inklusive Übertrag.
- Verständliche README: Setup, Konfiguration, Backup, Hinzufügen eines neuen Bank-Parsers.
- Barrierearme, schlichte Oberfläche; mobile-first, funktioniert ebenso in aktuellen Desktop-Browsern (siehe 6.1).

### 6.1 Mobile Nutzung und Zugriff

- **Mobile-first:** Das Layout wird für Handy-Bedienung mit einer Hand entworfen, ab 360 px Breite, und skaliert auf Desktop hoch. Alle Funktionen sind mobil nutzbar, auch Import und Einrichtungs-Assistent.
- **Touch:** Tippflächen mindestens 44 px, keine Funktion hängt an Hover oder Rechtsklick.
- **Dashboard:** einspaltig. Oben eine kompakte Kopfzeile (Einkommen, noch nicht verplant, ausgegeben), darunter eine Karte pro Kategorie mit Budget, Rest und Fortschrittsbalken.
- **Buchungsliste:** Kartenlayout statt breiter Tabelle. Die Kategorie einer Buchung lässt sich mit zwei Tipps ändern (Tipp auf die Buchung, dann Kategorie wählen).
- **Einrichtungs-Assistent:** ein Schritt pro Bildschirm, große Tippziele, Gruppen werden nacheinander abgearbeitet.
- **Installierbar (PWA, Annahme):** Symbol auf dem Startbildschirm und Vollbild. Kein Offline-Betrieb in V1, die App braucht eine Verbindung zum Server.
- **Zugriff vom Handy:** Die App läuft lokal auf dem Rechner, also muss das Handy diesen Rechner erreichen. Im Heimnetz (WLAN) über eine konfigurierbare Bindung an die lokale Netzwerkadresse. Zugriff von unterwegs ist in V1 nicht vorgesehen, und die App wird nie direkt ins öffentliche Internet freigegeben. Der Rechner muss dafür eingeschaltet sein. Standard bleibt die Bindung an 127.0.0.1 (siehe 4.9); die Freigabe fürs Netzwerk ist eine bewusste Einstellung.
- **Sicherheit bei Netzwerkzugriff:** HTTPS ist Pflicht. Bei Bindung außerhalb Loopback verweigert der Server ohne ladbares, gültiges TLS-Schlüssel-/Zertifikatspaar den Start. Zertifikaterzeugung berücksichtigt den verwendeten Hostnamen beziehungsweise die IP als Subject Alternative Name. Die README beschreibt das einmalige Vertrauen des selbstsignierten Zertifikats am Handy, Login-Begrenzung und Session-Timeout; keine öffentliche Internetfreigabe.
- **Tests:** Reale Bedienabläufe bei 360 px und am Desktop: keine horizontale Seitenüberbreite, alle Aktionen per Touch/Klick ohne Hover erreichbar, Import und Assistent vollständig bedienbar, Kategorieänderung in zwei Tipps. Ein gesetzter Viewport allein ist kein Nachweis.

## 7. Offene Punkte und Annahmen

- **Bank und CSV-Format:** noch offen, je Konto unterschiedlich möglich. Der konfigurierbare Generic-Parser plus Parser-Interface ist der vollständige V1-Umfang; reale Beispiel-CSVs sind kein Startblocker. Ein fester Bankparser ist eine spätere Erweiterung.
- **Budget-Modell:** Arbeitsannahme „Monatsbudget pro Kategorie mit Zero-Based-Anzeige“. Der Nutzer war unentschlossen.
- **Standardkategorien:** Vorschlag oben, vom Nutzer anpassbar.
- **Wiederkehrende Posten:** Abgleich als bestätigter Vorschlag (Annahme).
- **Monatsnavigation im Dashboard:** erlaubt (Annahme).
- **Umbuchungen:** Bestandteil von V1 einschließlich bestätigter Erkennung und Kreditkartenabrechnung. **Splits und Erstattungen als Gegenbuchung:** nicht in V1.
- **Framework-Wahl** (Backend, Frontend, ORM): Entscheidung beim Agenten, mit kurzer Begründung.

## 8. Meilensteine für den Agenten

1. Projektgerüst, SQLite-Schema und Migrationen, Passwort-Login, Konten anlegen.
2. Kategorien (Standardset), manuelle Zuordnung, Buchungsliste.
3. CSV-Import pro Konto mit Generic-Parser, Import-Profil, Duplikaterkennung.
4. Regel-Engine inklusive „Regel aus Korrektur erstellen“.
5. Budgets pro Monat, Übertrag, „noch nicht verplant“, Einkommenslogik.
6. Wiederkehrende Posten mit Abgleich.
7. Dashboard (standardmäßig aktueller Monat, Budget vs. Ist, Monatsnavigation).
8. Einrichtungs-Assistent: Import der Historie pro Konto, Gruppierung nach Gegenpartei, Erkennung von Einkommen, festen Kosten und Umbuchungen, Start-Budget-Vorschlag.
9. Tests, README, Feinschliff.

## 9. Ausbaustufen nach V1

- Verlauf über mehrere Monate (Trends)
- Warnungen bei Budgetüberschreitung
- Sparziele
- Konto-spezifische Budgets und weitergehende Kontenauswertungen (zusätzlich zum V1-Kontofilter)
- Fester Parser für die gewählte Bank
- Export und automatische Backups
