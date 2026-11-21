import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ParserError,
  ParserRegistry,
  genericParser,
  parserRegistry,
  parseCSV,
  type ParserConfig,
} from "../src/parser.js";

const german: ParserConfig = {
  delimiter: ";",
  encoding: "utf-8",
  date_format: "DD.MM.YYYY",
  decimal_format: ",",
  column_mapping: {
    booking_date: "Buchungstag",
    amount_cents: "Betrag",
    counterparty: "Name",
    purpose: "Verwendungszweck",
  },
};

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}

test("Generic-Parser importiert synthetische deutsche Bankdaten einschließlich Tausendern und CSV-Anführungszeichen", () => {
  assert.deepEqual(parseCSV(fixture("generic-german.csv"), german), [
    {
      booking_date: "2026-11-01",
      amount_cents: -123456,
      counterparty: "Beispiel Markt",
      purpose: "Wocheneinkauf; Filiale 17",
    },
    {
      booking_date: "2026-11-02",
      amount_cents: 250000,
      counterparty: "Muster Arbeitgeber",
      purpose: "Gehalt November",
    },
    {
      booking_date: "2026-11-03",
      amount_cents: -29,
      counterparty: "Café Beispiel",
      purpose: 'Kaffee "klein"',
    },
    {
      booking_date: "2026-11-04",
      amount_cents: 0,
      counterparty: "Beispiel Bank",
      purpose: "Information",
    },
  ]);
});

function csvRow(
  date: string,
  amount: string,
  counterparty = "Beispiel Händler",
  purpose = "Synthetischer Test",
): Buffer {
  return Buffer.from(
    `Buchungstag;Betrag;Name;Verwendungszweck\n${date};${amount};${counterparty};${purpose}\n`,
  );
}

function expectError(
  input: Buffer,
  config: ParserConfig,
  code: ParserError["code"],
  line: number,
): ParserError {
  let caught: ParserError | undefined;
  assert.throws(
    () => parseCSV(input, config),
    (error: unknown) => {
      assert.ok(error instanceof ParserError);
      assert.equal(error.code, code);
      assert.equal(error.line, line);
      assert.match(error.message, new RegExp(`^Zeile ${line}: `));
      caught = error;
      return true;
    },
  );
  return caught!;
}

test("leere Dateien und Dateien ohne Buchungen werden mit Zeilennummer abgelehnt", () => {
  for (const input of [
    "",
    " \r\n\t\r\n",
    "\uFEFF",
    "Buchungstag;Betrag;Name;Verwendungszweck\n",
  ]) {
    expectError(Buffer.from(input), german, "EMPTY_FILE", 1);
  }
});

test("falsches Trennzeichen und fehlende Pflichtspalten werden frühzeitig abgelehnt", () => {
  expectError(
    fixture("generic-german.csv"),
    { ...german, delimiter: "," },
    "WRONG_DELIMITER",
    1,
  );
  expectError(fixture("missing-column.csv"), german, "MISSING_COLUMN", 1);
});

test("doppelte Spaltennamen und inkonsistente Zeilen werden nicht still akzeptiert", () => {
  expectError(
    Buffer.from("Buchungstag;Betrag;Name;Name;Verwendungszweck\n"),
    german,
    "DUPLICATE_COLUMN",
    1,
  );
  expectError(
    Buffer.from(
      "Buchungstag;Betrag;Name;Verwendungszweck\n01.11.2026;1,00;Beispiel\n",
    ),
    german,
    "INVALID_CSV",
    2,
  );
  expectError(
    Buffer.from(
      "Buchungstag;Betrag;Name;Verwendungszweck\n01.11.2026;1,00;Beispiel;Test;extra\n",
    ),
    german,
    "INVALID_CSV",
    2,
  );
});

test("ungültige CSV-Anführungszeichen ergeben sichere Fehlermeldungen ohne Buchungsdaten", () => {
  const source = Buffer.from(
    'Buchungstag;Betrag;Name;Verwendungszweck\n01.11.2026;1,00;VERTRAULICH";Geheimer Zweck\n',
  );
  const error = expectError(source, german, "INVALID_CSV", 2);
  assert.doesNotMatch(error.message, /VERTRAULICH|Geheimer Zweck/u);
  expectError(
    Buffer.from(
      'Buchungstag;Betrag;Name;Verwendungszweck\n01.11.2026;1,00;Beispiel;"offen',
    ),
    german,
    "INVALID_CSV",
    2,
  );
});

test("ein fehlender Wert in jedem der vier Pflichtfelder wird abgelehnt", () => {
  for (const input of [
    csvRow("", "1,00"),
    csvRow("01.11.2026", ""),
    csvRow("01.11.2026", "1,00", ""),
    csvRow("01.11.2026", "1,00", "Beispiel", "  "),
  ]) {
    expectError(input, german, "MISSING_VALUE", 2);
  }
});

const international: ParserConfig = {
  delimiter: ",",
  encoding: "utf-8",
  date_format: "YYYY-MM-DD",
  decimal_format: ".",
  column_mapping: {
    booking_date: "Date",
    amount_cents: "Amount",
    counterparty: "Counterparty",
    purpose: "Purpose",
  },
};

test("konfigurierbare Spalten, Dezimalpunkte und englische Tausendergruppen werden importiert", () => {
  assert.deepEqual(
    parseCSV(fixture("generic-international.csv"), international),
    [
      {
        booking_date: "2024-02-29",
        amount_cents: -123456,
        counterparty: "Example Shop",
        purpose: "Synthetic purchase, terminal 42",
      },
      {
        booking_date: "2026-11-01",
        amount_cents: 29,
        counterparty: "Example Refund",
        purpose: "Exact cent amount",
      },
      {
        booking_date: "2026-11-02",
        amount_cents: 1050,
        counterparty: "Example Sender",
        purpose: "One decimal place",
      },
      {
        booking_date: "2026-11-03",
        amount_cents: -1200,
        counterparty: "Example Subscription",
        purpose: "Whole euros",
      },
    ],
  );
});

test("Centbeträge werden ohne Fließkomma-Rundung bis an die sichere Integergrenze gelesen", () => {
  for (const [source, expected] of [
    ["0,01", 1],
    ["0,29", 29],
    ["1,15", 115],
    ["-1,15", -115],
    ["+00012,3", 1230],
    ["-0,00", 0],
    ["90.071.992.547.409,91", 9007199254740991],
    ["-90.071.992.547.409,91", -9007199254740991],
  ] as const) {
    const result = parseCSV(csvRow("01.11.2026", source), german)[0]
      .amount_cents;
    assert.equal(result, expected);
    assert.ok(Number.isSafeInteger(result));
    assert.equal(Object.is(result, -0), false);
  }
});

test("mehrdeutige oder fehlerhafte Geldbeträge werden nicht gerundet oder teilweise eingelesen", () => {
  for (const amount of [
    "1,234",
    "12.34,56",
    "1.23.456,78",
    "1,234.56",
    "12.34",
    "1 234,56",
    "1,",
    ",99",
    "1.234,567",
    "EUR 12,34",
    "12,34 €",
    "1e3",
    "NaN",
    "Infinity",
    "(12,34)",
    "--12,34",
    "+-12,34",
    "90.071.992.547.409,92",
    "-90.071.992.547.409,92",
  ]) {
    expectError(csvRow("01.11.2026", amount), german, "INVALID_AMOUNT", 2);
  }
});

test("Kalenderdaten sind strikt und werden nicht durch Date-Normalisierung verschoben", () => {
  expectError(fixture("invalid-date.csv"), german, "INVALID_DATE", 3);
  for (const date of [
    "29.02.2026",
    "29.02.1900",
    "31.04.2026",
    "00.11.2026",
    "01.00.2026",
    "01.13.2026",
    "01.11.0000",
    "1.11.2026",
    "01.1.2026",
    "01.11.26",
    "2026-11-01",
  ]) {
    expectError(csvRow(date, "1,00"), german, "INVALID_DATE", 2);
  }
  assert.equal(
    parseCSV(csvRow("29.02.2000", "1,00"), german)[0].booking_date,
    "2000-02-29",
  );
  assert.equal(
    parseCSV(csvRow("01.01.0001", "1,00"), german)[0].booking_date,
    "0001-01-01",
  );
  assert.equal(
    parseCSV(csvRow("31/12/2026", "1,00"), {
      ...german,
      date_format: "DD/MM/YYYY",
    })[0].booking_date,
    "2026-12-31",
  );
  expectError(csvRow("31/12/2026", "1,00"), german, "INVALID_DATE", 2);
  expectError(
    Buffer.from(
      "Date,Amount,Counterparty,Purpose\n2026-02-29,1.00,Example,Test\n",
    ),
    international,
    "INVALID_DATE",
    2,
  );
});

test("leere Zeilen und mehrzeilige zitierte Verwendungszwecke behalten physische Zeilennummern", () => {
  const input = fixture("generic-multiline.csv");
  assert.deepEqual(parseCSV(input, german), [
    {
      booking_date: "2026-11-01",
      amount_cents: -1234,
      counterparty: "Beispiel Laden",
      purpose: "Erste Zeile\nzweite Zeile; mit Trennzeichen",
    },
    {
      booking_date: "2026-11-02",
      amount_cents: 1,
      counterparty: "Beispiel Bank",
      purpose: "Nachricht",
    },
  ]);
  expectError(
    Buffer.from(input.toString().replace("02.11.2026", "31.11.2026")),
    german,
    "INVALID_DATE",
    5,
  );
  expectError(
    Buffer.from(
      input
        .toString()
        .replaceAll("\n", "\r\n")
        .replace("02.11.2026", "31.11.2026"),
    ),
    german,
    "INVALID_DATE",
    5,
  );
});

test("Tabulator, umgeordnete Spalten, äußere Leerzeichen und CRLF werden unterstützt", () => {
  const input = Buffer.from(
    "\r\n Verwendungszweck \t Name \t Betrag \t Buchungstag \r\n Beispielzweck \t Beispielhändler \t -12,34 \t 01.11.2026 \r\n",
  );
  assert.deepEqual(parseCSV(input, { ...german, delimiter: "\t" }), [
    {
      booking_date: "2026-11-01",
      amount_cents: -1234,
      counterparty: "Beispielhändler",
      purpose: "Beispielzweck",
    },
  ]);
});

test("Windows-1252-Fixture erhält Umlaute, Eurozeichen und typografische Zeichen", () => {
  // Hex storage keeps legacy bytes intact even when editors normalize CSV files to UTF-8.
  const input = Buffer.from(
    fixture("generic-windows1252.hex").toString("ascii").trim(),
    "hex",
  );
  assert.deepEqual(parseCSV(input, { ...german, encoding: "windows-1252" }), [
    {
      booking_date: "2026-11-01",
      amount_cents: -1234,
      counterparty: "Café Müller",
      purpose: "Preis 12,34 € – synthetisch",
    },
  ]);
  expectError(input, german, "INVALID_ENCODING", 2);
});

test("ungültiges UTF-8, Encoding-BOM-Konflikte und UTF-16 werden nicht still ersetzt", () => {
  const invalid = Buffer.concat([
    Buffer.from("Buchungstag;Betrag;Name;Verwendungszweck\r\n01.11.2026;1,00;"),
    Buffer.from([0xc3, 0x28]),
    Buffer.from(";Test\r\n"),
  ]);
  expectError(invalid, german, "INVALID_ENCODING", 2);
  expectError(
    Buffer.from([0xff, 0xfe, 0x41, 0x00]),
    german,
    "INVALID_ENCODING",
    1,
  );
  expectError(
    Buffer.from([0xfe, 0xff, 0x00, 0x41]),
    german,
    "INVALID_ENCODING",
    1,
  );
  expectError(
    fixture("generic-german.csv"),
    { ...german, encoding: "windows-1252" },
    "INVALID_ENCODING",
    1,
  );
  expectError(
    csvRow("01.11.2026", "1,00", "Beispiel\0"),
    german,
    "INVALID_ENCODING",
    2,
  );
});

test("Import-Konfiguration wird vollständig geprüft statt still auf Standardwerte zurückzufallen", () => {
  const invalidConfigs: ParserConfig[] = [
    { ...german, delimiter: "" },
    { ...german, delimiter: ";;" },
    { ...german, delimiter: "\n" },
    { ...german, delimiter: '"' },
    { ...german, delimiter: " " },
    { ...german, encoding: "latin1" },
    { ...german, encoding: "utf-16" },
    { ...german, date_format: "MM/DD/YYYY" },
    { ...german, date_format: "__proto__" },
    { ...german, decimal_format: "auto" },
    { ...german, column_mapping: { ...german.column_mapping, purpose: "" } },
    {
      ...german,
      column_mapping: { ...german.column_mapping, purpose: " Name " },
    },
  ];
  for (const config of invalidConfigs) {
    expectError(fixture("generic-german.csv"), config, "INVALID_CONFIG", 1);
  }
  expectError(
    fixture("generic-german.csv"),
    null as unknown as ParserConfig,
    "INVALID_CONFIG",
    1,
  );
  expectError(
    fixture("generic-german.csv"),
    { ...german, column_mapping: undefined } as unknown as ParserConfig,
    "INVALID_CONFIG",
    1,
  );
});

test("echte identische Buchungen bleiben erhalten, statt im Parser dedupliziert zu werden", () => {
  const input = Buffer.from(
    "Buchungstag;Betrag;Name;Verwendungszweck\n01.11.2026;-1,00;Beispiel;Test\n01.11.2026;-1,00;Beispiel;Test\n",
  );
  assert.deepEqual(parseCSV(input, german), [
    {
      booking_date: "2026-11-01",
      amount_cents: -100,
      counterparty: "Beispiel",
      purpose: "Test",
    },
    {
      booking_date: "2026-11-01",
      amount_cents: -100,
      counterparty: "Beispiel",
      purpose: "Test",
    },
  ]);
});

test("Parser-Registry bietet den Generic-Parser und unterstützt austauschbare Parser ohne Überschreiben", () => {
  assert.equal(parserRegistry.get("generic"), genericParser);
  assert.deepEqual(
    parserRegistry.list().map((parser) => parser.id),
    ["generic"],
  );
  const registry = new ParserRegistry();
  registry.register({
    ...genericParser,
    id: "synthetic-bank",
    name: "Synthetische Beispielbank",
  });
  assert.equal(
    registry
      .get("synthetic-bank")
      .parse(fixture("generic-german.csv"), german)[0].amount_cents,
    -123456,
  );
  assert.throws(
    () => registry.register({ ...genericParser, id: "synthetic-bank" }),
    /bereits registriert/u,
  );
  assert.throws(() => registry.get("unknown"), /nicht registriert/u);
  registry.list().pop();
  assert.equal(registry.list().length, 1);
});

test("auch Fehler nach mehrzeiligen CRLF-Feldern melden die physische Startzeile der Buchung", () => {
  const source = fixture("generic-multiline.csv")
    .toString()
    .replaceAll("\n", "\r\n");
  expectError(
    Buffer.from(source.replace("02.11.2026;0,01", "02.11.2026;ungültig")),
    german,
    "INVALID_AMOUNT",
    5,
  );
  expectError(
    Buffer.from(
      source.replace(
        "02.11.2026;0,01;Beispiel Bank;Nachricht",
        "02.11.2026;0,01;Beispiel Bank",
      ),
    ),
    german,
    "INVALID_CSV",
    5,
  );
  expectError(
    Buffer.from(
      source.replace(
        "02.11.2026;0,01;Beispiel Bank",
        '02.11.2026;0,01;Beispiel" Bank',
      ),
    ),
    german,
    "INVALID_CSV",
    5,
  );
  expectError(
    Buffer.from(source.replace("01.11.2026", "31.11.2026")),
    german,
    "INVALID_DATE",
    3,
  );
  expectError(
    Buffer.from("\r\n\r\nBuchungstag;Betrag;Name\r\n"),
    german,
    "MISSING_COLUMN",
    3,
  );
});

test("Windows-1252-Erweiterungsbereich wird unabhängig von Node-ICU vollständig dekodiert", () => {
  const extensionBytes = Buffer.from([
    0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c,
    0x8e, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b,
    0x9c, 0x9e, 0x9f,
  ]);
  const prefix = Buffer.from(
    "Buchungstag;Betrag;Name;Verwendungszweck\r\n01.11.2026;1,00;Beispiel;",
  );
  const input = Buffer.concat([prefix, extensionBytes, Buffer.from("\r\n")]);
  assert.equal(
    parseCSV(input, { ...german, encoding: "windows-1252" })[0].purpose,
    "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ",
  );
  for (const undefinedByte of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
    expectError(
      Buffer.concat([
        prefix,
        Buffer.from([undefinedByte]),
        Buffer.from("\r\n"),
      ]),
      { ...german, encoding: "windows-1252" },
      "INVALID_ENCODING",
      2,
    );
  }
});
