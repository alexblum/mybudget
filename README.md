# Mein Budget

Lokale persönliche Budget-App. TypeScript, Node.js 22.13 oder neuer und SQLite; keine Cloud, Bankanbindung oder Telemetrie. Browser und Server kommunizieren nur direkt miteinander.

## Installation und Start

```sh
npm ci
npm start
```

Im Browser `http://127.0.0.1:3000` öffnen. Beim ersten Aufruf ein Passwort mit mindestens zehn Zeichen setzen, dann den Einrichtungs-Assistenten benutzen. CSV-Dateien bleiben lokal. Der Rechner muss eingeschaltet bleiben. Das Passwort ist nicht wiederherstellbar; die Datenbank ist nicht verschlüsselt. Betriebssystemkonto und Datenträger entsprechend schützen.

## Technik und Struktur

Fastify liefert API und statische Oberfläche aus einem Prozess. Vanilla JavaScript/CSS im Browser vermeidet Framework- und Build-Laufzeitabhängigkeiten. TypeScript prüft das Backend; `node:sqlite` verwendet das mit Node gelieferte SQLite ohne nativen Zusatzbuild. Kein ORM: parametrisierte SQL-Abfragen und versioniertes Schema halten Dateninvarianten sichtbar. `csv-parse` behandelt CSV-Quoting und Zeilen, bcrypt speichert ausschließlich Passwort-Hashes.

- `src/server.ts`: Start und Netzwerkkonfiguration
- `src/app.ts`: geschützte HTTP-Schnittstelle und bestätigte Schreibaktionen
- `src/db.ts`: SQLite-Schema und automatische Migration beim Start
- `src/parser.ts`: Parser-Interface und Generic-Parser
- `src/domain.ts`: Budget, Einkommen, Übertrag, Regeln und Vorschläge
- `public/`: deutsche mobile Oberfläche, Manifest und lokale Icons
- `tests/`: fachliche, HTTP- und Browser-Verhaltenstests
- `scripts/`: Zertifikat, synthetische Entwicklungsdaten und Leistungsmessung

## Konfiguration

| Variable   | Standard             | Bedeutung                            |
| ---------- | -------------------- | ------------------------------------ |
| `DB_PATH`  | `data/budget.sqlite` | Pfad der SQLite-Datenbank            |
| `HOST`     | `127.0.0.1`          | Bindeadresse                         |
| `PORT`     | `3000`               | TCP-Port                             |
| `TLS_KEY`  | nicht gesetzt        | PEM-Datei mit privatem TLS-Schlüssel |
| `TLS_CERT` | nicht gesetzt        | PEM-Zertifikatsdatei                 |

Finanzdaten werden nicht geloggt. Laufzeit und Browser benötigen keine externen Fonts, Skripte, Analytics oder sonstigen externen Requests. Die Paketinstallation benötigt einmalig Zugriff auf das npm-Registry.

## Heimnetz und Handy

Keine Portweiterleitung, keinen öffentlichen Tunnel und keine öffentliche Internetfreigabe einrichten. Nur vertrauenswürdige Geräte im eigenen WLAN zulassen; Firewall auf das Heimnetz begrenzen.

```sh
npm run cert -- 192.168.178.20
HOST=192.168.178.20 TLS_KEY=certs/key.pem TLS_CERT=certs/cert.pem npm start
```

OpenSSL muss installiert sein. Die Adresse durch die feste lokale Adresse des Rechners ersetzen. Der Befehl erzeugt ein selbstsigniertes Zertifikat mit passender Subject Alternative Name, gültig für ein Jahr. Private Schlüssel nicht weitergeben. Das Zertifikat `certs/cert.pem` über einen vertrauenswürdigen lokalen Weg aufs Handy übertragen und in dessen Zertifikatseinstellungen als vertrauenswürdig installieren. Unter iOS zusätzlich die volle Vertrauensstellung in den Zertifikatsvertrauenseinstellungen aktivieren. Je nach Browser/Betriebssystem kann für die Installation einer PWA ein systemweit vertrautes Zertifikat erforderlich sein. Keine Browserwarnung blind umgehen: zuerst Adresse und Zertifikat prüfen.

Dann `https://192.168.178.20:3000` öffnen und über das Browsermenü „Zum Startbildschirm hinzufügen“ beziehungsweise „App installieren“. Die App benötigt immer eine Verbindung zum Rechner; kein Offline-Betrieb. Bei Netzwerkbindung ohne TLS verweigert der Server den Start. Für andere Namen/IPs Zertifikat neu erzeugen und erneut vertrauen. Sichere Cookies werden unter HTTPS gesetzt. Sessions enden nach 30 Minuten Inaktivität; nach fünf falschen Anmeldungen je Quell-IP innerhalb 15 Minuten ist diese IP bis zum Ablauf gesperrt. Serverneustart meldet alle Browser ab.

## CSV und Import

Zielkonto wählen, Datei wählen, Trennzeichen, Encoding (`utf-8`/`windows-1252`), Datum, Dezimaltrennzeichen und Spaltennamen zuordnen. Beträge müssen vorzeichenbehaftet sein: positiv Eingang, negativ Ausgang. Vorschau prüfen und ausdrücklich bestätigen. Das Profil wird pro Konto gespeichert. Ein fehlerhafter Import schreibt keine Teilbuchungen.

Der Hash enthält Konto, Datum, Centbetrag, Gegenpartei und Verwendungszweck. Identische Vorkommen werden gezählt: zwei vorhandene und drei in der Datei ergeben eine neue Buchung. Echte identische Buchungen, die nie gemeinsam in einer Datei vorkommen, sind anhand dieser Informationen nicht unterscheidbar. Solche Zeiträume gemeinsam exportieren. Keine automatische externe Bankanbindung.
Der Assistent hat sechs Bildschirme: Konten, Historienimport, Gegenparteigruppen, Einkommen/feste Kosten/Umbuchungen, Startbudget und Zusammenfassung. „Später fortsetzen“ speichert den Schritt; bestätigte Aktionen und übersprungene Vorschläge bleiben auf dem Server erhalten. Unter „Mehr“ lässt er sich erneut öffnen, etwa für ein zusätzliches Konto. Neue CSV-Profile werden je Zielkonto gespeichert und beim nächsten Import wiederverwendet. Regelvorschläge und deren tatsächliche Treffer vor dem Bestätigen prüfen.

### PayPal importieren und abgleichen

1. Im CSV-Import „PayPal Deutschland Aktivitäten“ wählen. Ein separates PayPal-Konto ist nicht erforderlich. Den deutschen Transaktionsübersicht-Export hochladen; UTF-8 ist Standard, Windows-1252 ist auswählbar.
2. Vorschau prüfen und bestätigen. Die PayPal-Zeilen werden als Zusatzinformationen gespeichert, niemals als eigene Budgetbuchungen. Wiederholte Exporte werden anhand des Transaktionscodes erkannt; widersprüchliche Daten brechen den Import atomar ab.
3. Eindeutige Zuordnungen zu Bankbuchungen entstehen automatisch nach jedem Bank- oder PayPal-Import. Betrag, Richtung, PayPal-Bankfinanzierung beziehungsweise Auszahlung, Datumsabstand (höchstens 14 Tage) und verfügbare Händlerangaben dienen dem Abgleich. Bei mehreren möglichen Treffern wird keine Zuordnung erzwungen.
4. Die Kontobuchung trägt „PayPal verknüpft“. Aufklappbare Details zeigen Händler, PayPal-Datum, Beschreibung, Rechnung und Transaktionscodes. Bankbetrag, Bankdatum und Kategorie bleiben unverändert.
5. Im PayPal-Abgleich auf der Importseite offene Fälle prüfen, einen vorgeschlagenen Treffer manuell verknüpfen oder eine bestehende Zuordnung lösen und korrigieren. Eine gelöste Zuordnung wird nicht beim nächsten Import automatisch wiederhergestellt.

Nicht zugeordnete PayPal-Vorgänge erscheinen ausschließlich im Abgleich, nicht im Budget. Käuferkredit-Käufe bleiben entsprechend markiert: Eine einzelne spätere Bankrate ist keinem Kauf zuverlässig zuzuordnen. Sammelabbuchungen, Teilfinanzierungen und Kreditraten werden nicht automatisch verknüpft. PayPal-Erstattungsdetails ändern die bestehende Budgetbehandlung der Bankgutschrift nicht.

Beim nächsten Start migriert die App zuvor als Kontobuchungen importierte PayPal-Zeilen in den Detailbestand. Zugehörige alte Umbuchungen werden aufgelöst und die ursprünglichen Kategorien der Bankbuchungen wiederhergestellt. Vor einem Versionswechsel wie üblich eine Datenbanksicherung erstellen.

Unterstützt werden die Buchungsarten des deutschen Beispiel-Exports, ausschließlich EUR ohne PayPal-Entgelt. Unbekannte Buchungsarten, Fremdwährung, Entgelt sowie fehlende oder doppelte Transaktionscodes führen zu einem Fehler. Versandkosten werden nicht zusätzlich addiert: Maßgeblich ist der Netto-Buchungsbetrag.

## Fachliche Regeln

Budgets gelten über alle Konten. Der Dashboard-Kontofilter ergänzt klar beschriftete Kontowerte, verändert aber keine globalen Budgets oder Reste. Einkommen sind nur positive Buchungen markierter Einkommenskategorien. Vor dem ersten monatlichen Eingang gilt ausschließlich das tatsächliche Einkommen des direkten Vormonats, sonst null.

Offene feste Posten reservieren innerhalb des Budgets; sie erhöhen es nicht. Nach bestätigter Zahlung zählt nur die Buchung als Ausgabe. Umbuchungen erfordern Bestätigung und zählen weder als Einkommen noch Ausgabe. Positive Buchungen normaler Kategorien werden nicht als Erstattungs-Gegenrechnung behandelt. PayPal-Details verändern keine Budgetbeträge.

Übertrag wirkt pro Kategorie über die gesamte Historie, auch bei negativen Resten. Änderungen rückwirkender Buchungen/Budgets ändern Folgemonate; Umschalten wirkt ebenfalls rückwirkend. Neue Monatsbudgets übernehmen den Vormonat, gespeicherte Werte werden nicht still überschrieben. Einkommens- und ausgeschlossene Kategorien sind nicht budgetierbar.

## Backup und Wiederherstellung

1. App mit Strg+C beziehungsweise SIGTERM sauber beenden. Der Server schließt SQLite nach einem WAL-Checkpoint.
2. Sicherstellen, dass kein weiterer Prozess die Datenbank geöffnet hat. Die alleinige Hauptdatei nur kopieren, wenn das Journal vollständig zurückgeschrieben ist. Bei verbliebener nichtleerer `-wal`-Datei **nicht nur** die Hauptdatei kopieren. Mit installiertem SQLite-Werkzeug bei gestoppter App `sqlite3 data/budget.sqlite 'PRAGMA wal_checkpoint(TRUNCATE);'` ausführen und Erfolg prüfen; alternativ die SQLite-Backup-Funktion verwenden.
3. Die Datei am konfigurierten `DB_PATH` an einen geschützten Ort kopieren. Backups enthalten sämtliche Finanzdaten und den Passwort-Hash.
4. Zum Wiederherstellen die App stoppen und den aktuellen Datenbankbestand einschließlich Journaldateien separat sichern. Den Datenbankpfad in einen sauberen Zielordner wiederherstellen; keine alten `-wal`/`-shm`-Dateien mit einer anderen Hauptdatei mischen. Mit passendem `DB_PATH` starten und Daten kontrollieren.

Kein automatisches Backup und kein Exportdialog in V1. Zertifikate und private Schlüssel separat geschützt sichern, wenn dieselbe HTTPS-Konfiguration weiterverwendet werden soll.

## Neuen Bank-Parser hinzufügen

Das V1-Format ist vollständig über den Generic-Parser konfigurierbar. Ein eigener Parser implementiert `CSVParser` aus `src/parser.ts`, gibt ausschließlich ISO-Datum, ganzzahlige Centbeträge, Gegenpartei und Verwendungszweck zurück und wird mit `parserRegistry.register(parser)` registriert. Abruf über `parserRegistry.get(id)`. Keine Netzwerkzugriffe oder Rohdaten in Fehlermeldungen.

```ts
import { parserRegistry, type CSVParser, parseCSV } from "./parser.js";
const bankParser: CSVParser = {
  id: "meine-bank",
  name: "Meine Bank",
  parse(input, config) {
    return parseCSV(input, {
      ...config,
      delimiter: ";",
      date_format: "DD.MM.YYYY",
      decimal_format: ",",
    });
  },
};
parserRegistry.register(bankParser);
```

Für die Anbindung an die Oberfläche eine explizite Parserauswahl und serverseitige Auswahl aus der Registry ergänzen; keine frei geladenen Module akzeptieren. Anonymisierte Fixtures für das konkrete Bankformat hinzufügen. Die Anwendung verwendet in V1 bewusst ausschließlich den Generic-Parser.

## Entwicklung und Prüfung

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run benchmark
npm run seed
```

`npm run format` formatiert Quelltexte. Die Entwicklungssaat ist explizit und gehört nicht in eine produktive Datenbank. Tests verwenden isolierte Datenbanken. Die Leistungsmessung nutzt 50.000 synthetische Buchungen, fünf Jahre und vier Konten; sie dokumentiert Hardware/Software und prüft p95 ≤ 500 ms für 30 warme API-Aufrufe. Browserprüfung umfasst mobile 360 px und Desktop, lokale Requests und den Einrichtungs-Hauptpfad.

Verifizierter Stand: 45 Fach-/HTTP-/Datenschutztests und zwei Browser-Hauptpfade (360 px sowie 1280 px) bestanden; Typecheck und Lint ohne Fehler. Letzte lokale API-Messung: Dashboard p95 176,96 ms, gefilterte Buchungsseite p95 2,03 ms bei 50.000 Buchungen und jeweils 30 warmen Aufrufen. Umgebung: Node 22.19.0, Linux 6.8, AMD EPYC 9354, 16 sichtbare CPU-Kerne, 31 GiB RAM. Das temporäre Dateisystem wurde verwendet; dessen physische SSD-Unterlage ist in dieser Umgebung nicht nachgewiesen. Der Browsertest prüft zusätzlich die Darstellung des Dashboards innerhalb einer Sekunde nach API-Antwort.

Die anschließende zweiachsige Codeprüfung (Standards/Sicherheit und Spezifikation) führte zu zusätzlichen Korrekturen: kodierte API-Pfade unterliegen derselben Anmeldung, unbenutzte Kategorien sind ohne Ersatz löschbar, Zuordnungsrücknahmen stellen den vorherigen Zustand wieder her und wiederholte Einrichtung verarbeitet auch neue Buchungen. Die fünf HTTP-Regressionsfälle wurden danach erneut erfolgreich ausgeführt, einschließlich des neuen Löschfalls und des kodierten Pfads; Typecheck und Lint bestanden erneut.

