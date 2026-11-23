import { TextDecoder } from "node:util";
import { CsvError, parse } from "csv-parse/sync";

export interface ParserConfig {
  delimiter: string;
  encoding: string;
  date_format: string;
  decimal_format: string;
  column_mapping: {
    booking_date: string;
    amount_cents: string;
    counterparty: string;
    purpose: string;
  };
}

export interface ParsedTransaction {
  booking_date: string;
  amount_cents: number;
  counterparty: string;
  purpose: string;
}

export interface CSVParser {
  readonly id: string;
  readonly name: string;
  parse(input: Buffer, config: ParserConfig): ParsedTransaction[];
}

export type ParserErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_ENCODING"
  | "EMPTY_FILE"
  | "WRONG_DELIMITER"
  | "MISSING_COLUMN"
  | "DUPLICATE_COLUMN"
  | "INVALID_CSV"
  | "INVALID_DATE"
  | "INVALID_AMOUNT"
  | "MISSING_VALUE";

/** Errors deliberately omit source field values, which may contain financial data. */
export class ParserError extends Error {
  constructor(
    public readonly code: ParserErrorCode,
    public readonly line: number,
    message: string,
  ) {
    super(`Zeile ${line}: ${message}`);
    this.name = "ParserError";
  }
}

const fields = [
  "booking_date",
  "amount_cents",
  "counterparty",
  "purpose",
] as const;
const dateFormats: Record<string, true> = {
  "DD.MM.YYYY": true,
  "YYYY-MM-DD": true,
  "DD/MM/YYYY": true,
};
const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const maxSafeCents = BigInt(Number.MAX_SAFE_INTEGER);
const windows1252Extensions: Record<string, string> = {
  "\u0080": "€",
  "\u0082": "‚",
  "\u0083": "ƒ",
  "\u0084": "„",
  "\u0085": "…",
  "\u0086": "†",
  "\u0087": "‡",
  "\u0088": "ˆ",
  "\u0089": "‰",
  "\u008a": "Š",
  "\u008b": "‹",
  "\u008c": "Œ",
  "\u008e": "Ž",
  "\u0091": "‘",
  "\u0092": "’",
  "\u0093": "“",
  "\u0094": "”",
  "\u0095": "•",
  "\u0096": "–",
  "\u0097": "—",
  "\u0098": "˜",
  "\u0099": "™",
  "\u009a": "š",
  "\u009b": "›",
  "\u009c": "œ",
  "\u009e": "ž",
  "\u009f": "Ÿ",
};

function validateConfig(config: ParserConfig): void {
  if (!config || typeof config !== "object") {
    throw new ParserError("INVALID_CONFIG", 1, "Import-Konfiguration fehlt.");
  }
  if (
    typeof config.delimiter !== "string" ||
    [...config.delimiter].length !== 1 ||
    /[\r\n"\0]/u.test(config.delimiter) ||
    (config.delimiter !== "\t" && /\s/u.test(config.delimiter))
  ) {
    throw new ParserError(
      "INVALID_CONFIG",
      1,
      "Ein einzelnes Trennzeichen angeben (z. B. Semikolon, Komma oder Tabulator).",
    );
  }
  if (config.encoding !== "utf-8" && config.encoding !== "windows-1252") {
    throw new ParserError(
      "INVALID_CONFIG",
      1,
      "Unterstützte Encodings sind utf-8 und windows-1252.",
    );
  }
  if (!Object.hasOwn(dateFormats, config.date_format)) {
    throw new ParserError(
      "INVALID_CONFIG",
      1,
      "Datumsformat muss DD.MM.YYYY, YYYY-MM-DD oder DD/MM/YYYY sein.",
    );
  }
  if (config.decimal_format !== "," && config.decimal_format !== ".") {
    throw new ParserError(
      "INVALID_CONFIG",
      1,
      "Dezimaltrennzeichen muss Komma oder Punkt sein.",
    );
  }
  const mapping = config.column_mapping;
  if (
    !mapping ||
    typeof mapping !== "object" ||
    fields.some(
      (field) => typeof mapping[field] !== "string" || !mapping[field].trim(),
    )
  ) {
    throw new ParserError(
      "INVALID_CONFIG",
      1,
      "Alle vier Pflichtfelder müssen einer CSV-Spalte zugeordnet sein.",
    );
  }
  if (
    new Set(fields.map((field) => mapping[field].trim())).size !== fields.length
  ) {
    throw new ParserError(
      "INVALID_CONFIG",
      1,
      "Jedes Pflichtfeld muss einer eigenen CSV-Spalte zugeordnet sein.",
    );
  }
}

function countLines(text: string): number {
  let lines = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\r") {
      lines++;
      if (text[index + 1] === "\n") index++;
    } else if (text[index] === "\n") {
      lines++;
    }
  }
  return lines;
}

function invalidEncodingLine(input: Buffer): number {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let line = 1;
  let start = 0;
  for (let index = 0; index <= input.length; index++) {
    if (index !== input.length && input[index] !== 10 && input[index] !== 13)
      continue;
    try {
      decoder.decode(input.subarray(start, index));
    } catch {
      return line;
    }
    if (input[index] === 13 && input[index + 1] === 10) index++;
    start = index + 1;
    line++;
  }
  return 1;
}

function decode(input: Buffer, encoding: string): string {
  if (!Buffer.isBuffer(input)) {
    throw new ParserError(
      "INVALID_ENCODING",
      1,
      "CSV-Datei muss als Binärdatei übergeben werden.",
    );
  }
  // A UTF-16 BOM must not silently turn into corrupt header text in a legacy encoding.
  if (
    (input[0] === 0xff && input[1] === 0xfe) ||
    (input[0] === 0xfe && input[1] === 0xff) ||
    (encoding !== "utf-8" &&
      input[0] === 0xef &&
      input[1] === 0xbb &&
      input[2] === 0xbf)
  ) {
    throw new ParserError(
      "INVALID_ENCODING",
      1,
      "Datei-Encoding stimmt nicht mit dem gewählten Encoding überein.",
    );
  }
  let text: string;
  if (encoding === "windows-1252") {
    // Some Node builds alias this TextDecoder encoding to Latin-1. Decode the
    // Windows-specific range explicitly so imports are independent of ICU.
    const latin1 = input.toString("latin1");
    text = latin1.replace(/[\u0080-\u009f]/gu, (character, offset: number) => {
      const replacement = windows1252Extensions[character];
      if (replacement === undefined) {
        throw new ParserError(
          "INVALID_ENCODING",
          countLines(latin1.slice(0, offset)) + 1,
          "Datei enthält ein in Windows-1252 nicht definiertes Byte.",
        );
      }
      return replacement;
    });
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new ParserError(
        "INVALID_ENCODING",
        invalidEncodingLine(input),
        "Datei ist im gewählten Encoding nicht lesbar.",
      );
    }
  }
  const nul = text.indexOf("\0");
  if (nul !== -1) {
    throw new ParserError(
      "INVALID_ENCODING",
      countLines(text.slice(0, nul)) + 1,
      "Datei enthält Nullbytes; bitte das Encoding prüfen.",
    );
  }
  return text;
}

function parseDate(value: string, format: string, line: number): string {
  let parts: RegExpMatchArray | null;
  let year: number;
  let month: number;
  let day: number;
  if (format === "YYYY-MM-DD") {
    parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    year = Number(parts?.[1]);
    month = Number(parts?.[2]);
    day = Number(parts?.[3]);
  } else {
    parts = value.match(
      format === "DD.MM.YYYY"
        ? /^(\d{2})\.(\d{2})\.(\d{4})$/u
        : /^(\d{2})\/(\d{2})\/(\d{4})$/u,
    );
    year = Number(parts?.[3]);
    month = Number(parts?.[2]);
    day = Number(parts?.[1]);
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = month === 2 && leap ? 29 : daysPerMonth[month - 1];
  if (
    !parts ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > maxDay
  ) {
    throw new ParserError(
      "INVALID_DATE",
      line,
      "Buchungsdatum ist ungültig oder entspricht nicht dem gewählten Datumsformat.",
    );
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(value: string, decimal: string, line: number): number {
  const pattern =
    decimal === ","
      ? /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/u
      : /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/u;
  const parts = value.match(pattern);
  if (!parts) {
    throw new ParserError(
      "INVALID_AMOUNT",
      line,
      "Betrag ist ungültig; Dezimalformat und Tausendergruppen prüfen (höchstens zwei Nachkommastellen).",
    );
  }
  const whole = parts[2].replace(/[.,]/gu, "").replace(/^0+(?=\d)/u, "");
  if (whole.length > 14) {
    throw new ParserError(
      "INVALID_AMOUNT",
      line,
      "Betrag überschreitet den sicher unterstützten Centbereich.",
    );
  }
  // Decimal digits are converted with integer arithmetic only: never parseFloat or rounding.
  const magnitude =
    BigInt(whole) * 100n + BigInt((parts[3] ?? "").padEnd(2, "0"));
  if (magnitude > maxSafeCents) {
    throw new ParserError(
      "INVALID_AMOUNT",
      line,
      "Betrag überschreitet den sicher unterstützten Centbereich.",
    );
  }
  return magnitude === 0n
    ? 0
    : Number(parts[1] === "-" ? -magnitude : magnitude);
}

/** Parse one complete CSV atomically; callers receive no partial result on any error. */
export function parseCSV(
  input: Buffer,
  config: ParserConfig,
): ParsedTransaction[] {
  validateConfig(config);
  const text = decode(input, config.encoding);
  if (!text.trim()) {
    throw new ParserError("EMPTY_FILE", 1, "CSV-Datei ist leer.");
  }
  const rows: ParsedTransaction[] = [];
  let indices: number[] | undefined;
  let headerLine = 1;
  const source = Buffer.from(text, "utf-8");
  let previousRecordEnd = 0;
  let lineOffset = 0;
  let physicalLine = 1;
  // csv-parse counts CRLF twice inside quoted fields. Use its byte boundaries,
  // not its line counter, to report the physical start of each source record.
  function recordLine(): number {
    let start = previousRecordEnd;
    while (
      start < source.length &&
      (source[start] === 32 ||
        source[start] === 9 ||
        source[start] === 10 ||
        source[start] === 13)
    )
      start++;
    while (lineOffset < start) {
      if (
        source[lineOffset] === 13 ||
        (source[lineOffset] === 10 && source[lineOffset - 1] !== 13)
      )
        physicalLine++;
      lineOffset++;
    }
    return physicalLine;
  }
  try {
    parse(source, {
      delimiter: config.delimiter,
      skip_empty_lines: true,
      trim: true,
      on_record(record: string[], info) {
        const line = recordLine();
        previousRecordEnd = info.bytes;
        if (!indices) {
          headerLine = line;
          if (record.length === 1) {
            throw new ParserError(
              "WRONG_DELIMITER",
              line,
              "Keine getrennten Spalten erkannt; bitte das Trennzeichen prüfen.",
            );
          }
          const names = record.map((name) => name.trim());
          if (new Set(names).size !== names.length) {
            throw new ParserError(
              "DUPLICATE_COLUMN",
              line,
              "CSV enthält doppelte Spaltennamen; eine eindeutige Zuordnung ist nicht möglich.",
            );
          }
          indices = fields.map((field) =>
            names.indexOf(config.column_mapping[field].trim()),
          );
          if (indices.some((index) => index === -1)) {
            throw new ParserError(
              "MISSING_COLUMN",
              line,
              "Mindestens eine zugeordnete Pflichtspalte fehlt; Spaltenzuordnung und Trennzeichen prüfen.",
            );
          }
          return null;
        }
        const [date, amount, counterparty, purpose] = indices.map((index) =>
          record[index].trim(),
        );
        if (!date || !amount || !counterparty || !purpose) {
          throw new ParserError(
            "MISSING_VALUE",
            line,
            "Ein Pflichtfeld der Buchung ist leer.",
          );
        }
        rows.push({
          booking_date: parseDate(date, config.date_format, line),
          amount_cents: parseAmount(amount, config.decimal_format, line),
          counterparty,
          purpose,
        });
        return null;
      },
    });
  } catch (error) {
    if (error instanceof ParserError) throw error;
    if (error instanceof CsvError) {
      const line = recordLine();
      const message =
        error.code === "CSV_RECORD_INCONSISTENT_FIELDS_LENGTH"
          ? "Spaltenanzahl stimmt nicht mit der Kopfzeile überein; Trennzeichen und Anführungszeichen prüfen."
          : "CSV-Struktur ist ungültig; Trennzeichen und Anführungszeichen prüfen.";
      throw new ParserError("INVALID_CSV", line, message);
    }
    throw error;
  }
  if (rows.length === 0) {
    throw new ParserError(
      "EMPTY_FILE",
      headerLine,
      "CSV-Datei enthält keine Buchungen.",
    );
  }
  return rows;
}

export const genericParser: CSVParser = {
  id: "generic",
  name: "Konfigurierbarer CSV-Parser",
  parse: parseCSV,
};

export const ingParser: CSVParser = {
  id: "ing-de",
  name: "ING Deutschland Umsatzanzeige",
  parse(input, config) {
    const text = decode(input, config.encoding);
    const header =
      "Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Referenz;Saldo;Währung;Betrag;Währung";
    const headerStart = text.indexOf(header);
    if (headerStart < 0) {
      throw new ParserError(
        "MISSING_COLUMN",
        1,
        "ING-Kopfzeile wurde nicht gefunden.",
      );
    }
    const body = text.slice(headerStart);
    const records = parse(body, {
      delimiter: ";",
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
    const names = records[0];
    const booking = names.indexOf("Buchung");
    const counterparty = names.indexOf("Auftraggeber/Empfänger");
    const bookingText = names.indexOf("Buchungstext");
    const purpose = names.indexOf("Verwendungszweck");
    const amount = names.indexOf("Betrag");
    if (
      [booking, counterparty, bookingText, purpose, amount].some(
        (index) => index < 0,
      )
    ) {
      throw new ParserError("MISSING_COLUMN", 1, "ING-Pflichtspalte fehlt.");
    }
    return records.slice(1).map((record, index) => {
      const line = index + 2;
      const details = record[purpose]?.trim();
      const type = record[bookingText]?.trim();
      if (!record[booking]?.trim() || !type || !record[amount]?.trim()) {
        throw new ParserError(
          "MISSING_VALUE",
          line,
          "Ein ING-Pflichtfeld der Buchung ist leer.",
        );
      }
      return {
        booking_date: parseDate(record[booking].trim(), "DD.MM.YYYY", line),
        amount_cents: parseAmount(record[amount].trim(), ",", line),
        counterparty: record[counterparty]?.trim() || type,
        purpose: details ? `${type} · ${details}` : type,
      };
    });
  },
};

export const sparkasseParser: CSVParser = {
  id: "sparkasse-camt52",
  name: "Sparkasse CAMT52 v8",
  parse(input, config) {
    const text = decode(input, config.encoding);
    const records = parse(text, {
      delimiter: ";",
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
    if (records.length < 2)
      throw new ParserError(
        "EMPTY_FILE",
        1,
        "Sparkassen-Datei enthält keine Buchungen.",
      );
    const names = records[0];
    const booking = names.indexOf("Buchungstag");
    const bookingText = names.indexOf("Buchungstext");
    const purpose = names.indexOf("Verwendungszweck");
    const counterparty = names.indexOf("Beguenstigter/Zahlungspflichtiger");
    const amount = names.indexOf("Betrag");
    const status = names.indexOf("Info");
    if (
      [booking, bookingText, purpose, counterparty, amount, status].some(
        (index) => index < 0,
      )
    )
      throw new ParserError(
        "MISSING_COLUMN",
        1,
        "Sparkassen-Pflichtspalte fehlt.",
      );
    const rows: ParsedTransaction[] = [];
    for (const [index, record] of records.slice(1).entries()) {
      const line = index + 2;
      if (record[status]?.trim().toLowerCase() !== "umsatz gebucht") continue;
      const dateParts = record[booking]
        ?.trim()
        .match(/^(\d{2})\.(\d{2})\.(\d{2})$/u);
      if (!dateParts)
        throw new ParserError(
          "INVALID_DATE",
          line,
          "Sparkassen-Buchungstag ist ungültig.",
        );
      const type = record[bookingText]?.trim();
      const party = record[counterparty]?.trim();
      const details = record[purpose]?.trim();
      if (!type || !party || !record[amount]?.trim())
        throw new ParserError(
          "MISSING_VALUE",
          line,
          "Ein Sparkassen-Pflichtfeld der Buchung ist leer.",
        );
      rows.push({
        booking_date: parseDate(
          `${dateParts[1]}.${dateParts[2]}.20${dateParts[3]}`,
          "DD.MM.YYYY",
          line,
        ),
        amount_cents: parseAmount(record[amount].trim(), ",", line),
        counterparty: party,
        purpose: details ? `${type} · ${details}` : type,
      });
    }
    if (!rows.length)
      throw new ParserError(
        "EMPTY_FILE",
        1,
        "Sparkassen-Datei enthält keine gebuchten Umsätze.",
      );
    return rows;
  },
};

export class ParserRegistry {
  private readonly parsers = new Map<string, CSVParser>();

  register(parser: CSVParser): void {
    if (
      !parser.id.trim() ||
      !parser.name.trim() ||
      typeof parser.parse !== "function"
    ) {
      throw new Error(
        "Parser benötigt eine ID, einen Namen und eine parse-Funktion.",
      );
    }
    if (this.parsers.has(parser.id))
      throw new Error("Parser-ID ist bereits registriert.");
    this.parsers.set(parser.id, parser);
  }

  get(id: string): CSVParser {
    const parser = this.parsers.get(id);
    if (!parser) throw new Error("Parser ist nicht registriert.");
    return parser;
  }

  list(): CSVParser[] {
    return [...this.parsers.values()];
  }
}

export const parserRegistry = new ParserRegistry();
parserRegistry.register(genericParser);
parserRegistry.register(ingParser);
parserRegistry.register(sparkasseParser);
