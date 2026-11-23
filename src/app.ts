import Fastify, { type FastifyRequest } from "fastify";
import staticFiles from "@fastify/static";
import bcrypt from "bcryptjs";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { openDatabase, atomic } from "./db.js";
import { parserRegistry, type ParserConfig } from "./parser.js";
import {
  matchRule,
  dashboard,
  recurringDates,
  normalizeParty,
  normalizeHistoryParty,
  detectHistory,
  startBudgets,
  suggestCategory,
  type Transaction,
  type Category,
  type Rule,
  type Budget,
} from "./domain.js";

type Row = Record<string, SQLOutputValue>;
type Input = Record<string, unknown>;
type Interval = "monthly" | "quarterly" | "yearly";
type Session = { csrf: string; authenticated: boolean; touched: number };
type RequestSession = { session: Session | undefined; id: string | undefined };
interface RecurringItem {
  id: number;
  name: string;
  amount_cents: number;
  interval: Interval;
  first_due_date: string;
  category_id: number;
  counterparty_hint: string;
}
interface Occurrence {
  id: number;
  recurring_item_id: number;
  due_date: string;
  amount_cents: number;
  category_id: number;
  matched_transaction_id: number | null;
}
interface TransferPair {
  id: number;
  outgoing_transaction_id: number;
  incoming_transaction_id: number;
}
interface SetupGroup {
  key: string;
  name: string;
  transaction_ids: number[];
  count: number;
  total_cents: number;
  match_text: string;
  suggested_category_id: number | null;
}

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
function requireThat(
  value: unknown,
  message = "Ungültige Eingabe",
  status = 400,
): asserts value {
  if (!value) throw new HttpError(status, message);
}
function isObject(value: unknown): value is Input {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function object(value: unknown): Input {
  requireThat(isObject(value), "Ein Objekt wird erwartet");
  return value;
}
function string(value: unknown, max = 1000): string {
  requireThat(
    typeof value === "string" && value.length <= max,
    "Ungültiger Text",
  );
  return value;
}
function text(value: unknown): string {
  const result = string(value).trim();
  requireThat(result.length > 0, "Text darf nicht leer sein");
  return result;
}
function list(value: unknown): unknown[] {
  requireThat(Array.isArray(value), "Eine Liste wird erwartet");
  return value;
}
function textList(value: unknown): string[] {
  return list(value).map((item) => text(item));
}
function integer(
  value: unknown,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  requireThat(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max,
    "Ungültige ganze Zahl",
  );
  return value;
}
function id(value: unknown): number {
  return integer(value, 1);
}
function nullableId(value: unknown): number | null {
  return value === null ? null : id(value);
}
function boolean(value: unknown): boolean {
  requireThat(typeof value === "boolean", "Wahrheitswert erforderlich");
  return value;
}
function flag(value: unknown): number {
  if (value === undefined) return 0;
  requireThat(
    value === true || value === false || value === 0 || value === 1,
    "Ungültiges Kategorie-Flag",
  );
  return Number(value);
}
function choice<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] {
  requireThat(typeof value === "string", "Ungültige Auswahl");
  const result = values.find((item) => item === value);
  requireThat(result !== undefined, "Ungültige Auswahl");
  return result;
}
function month(value: unknown): string {
  requireThat(
    typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value),
    "Ungültiger Monat",
  );
  return value;
}
function date(value: unknown): string {
  requireThat(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Ungültiges Datum",
  );
  return value;
}
function queryInteger(value: unknown, min = 1): number {
  requireThat(
    typeof value === "string" && /^\d+$/.test(value),
    "Ungültiger Zahlenparameter",
  );
  return integer(Number(value), min);
}
function optionalQueryId(value: unknown): number | undefined {
  return value === undefined || value === "" ? undefined : queryInteger(value);
}
function parameterId(value: unknown): number {
  return queryInteger(object(value).id);
}
const currentMonth = () => new Date().toLocaleDateString("sv-SE").slice(0, 7);

function parserConfig(value: unknown): ParserConfig {
  const input = object(value),
    mapping = object(input.column_mapping);
  const delimiter = string(input.delimiter);
  requireThat(
    [...delimiter].length === 1 && !/[\r\n"\0 ]/.test(delimiter),
    "Ungültiges Trennzeichen",
  );
  const column_mapping = {
    booking_date: text(mapping.booking_date),
    amount_cents: text(mapping.amount_cents),
    counterparty: text(mapping.counterparty),
    purpose: text(mapping.purpose),
  };
  requireThat(
    new Set(Object.values(column_mapping)).size === 4,
    "Spalten müssen verschieden sein",
  );
  return {
    delimiter,
    encoding: choice(input.encoding, ["utf-8", "windows-1252"]),
    date_format: choice(input.date_format, [
      "DD.MM.YYYY",
      "YYYY-MM-DD",
      "DD/MM/YYYY",
    ]),
    decimal_format: choice(input.decimal_format, [",", "."]),
    column_mapping,
  };
}
function categoryRow(row: Row): Category {
  return {
    id: id(row.id),
    name: string(row.name),
    sort_order: integer(row.sort_order),
    carryover_enabled: integer(row.carryover_enabled, 0, 1),
    is_income: integer(row.is_income, 0, 1),
    is_excluded: integer(row.is_excluded, 0, 1),
  };
}
function transactionRow(row: Row): Transaction {
  return {
    id: id(row.id),
    account_id: id(row.account_id),
    booking_date: date(row.booking_date),
    amount_cents: integer(row.amount_cents),
    counterparty: string(row.counterparty, Number.MAX_SAFE_INTEGER),
    purpose: string(row.purpose, Number.MAX_SAFE_INTEGER),
    category_id: nullableId(row.category_id),
    category_source:
      row.category_source === null
        ? null
        : choice(row.category_source, ["manual", "rule"]),
  };
}
function ruleRow(row: Row): Rule {
  return {
    id: id(row.id),
    match_text: text(row.match_text),
    match_field: choice(row.match_field, ["counterparty", "purpose", "both"]),
    category_id: id(row.category_id),
    priority: integer(row.priority),
  };
}
function budgetRow(row: Row): Budget {
  return {
    month: month(row.month),
    category_id: id(row.category_id),
    amount_cents: integer(row.amount_cents, 0),
  };
}
function recurringRow(row: Row): RecurringItem {
  return {
    id: id(row.id),
    name: text(row.name),
    amount_cents: integer(row.amount_cents, 1),
    interval: choice(row.interval, ["monthly", "quarterly", "yearly"]),
    first_due_date: date(row.first_due_date),
    category_id: id(row.category_id),
    counterparty_hint: string(row.counterparty_hint),
  };
}
function occurrenceRow(row: Row): Occurrence {
  return {
    id: id(row.id),
    recurring_item_id: id(row.recurring_item_id),
    due_date: date(row.due_date),
    amount_cents: integer(row.amount_cents, 1),
    category_id: id(row.category_id),
    matched_transaction_id: nullableId(row.matched_transaction_id),
  };
}
function pairRow(row: Row): TransferPair {
  return {
    id: id(row.id),
    outgoing_transaction_id: id(row.outgoing_transaction_id),
    incoming_transaction_id: id(row.incoming_transaction_id),
  };
}

export async function createApp(options: {
  dbPath: string;
  https?: { key: Buffer; cert: Buffer };
  now?: () => number;
}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 24 * 1024 * 1024,
    ...(options.https ? { https: options.https } : {}),
  });
  const db = openDatabase(options.dbPath),
    now = options.now ?? Date.now;
  const all = (sql: string, ...args: SQLInputValue[]): Row[] =>
    db.prepare(sql).all(...args);
  const get = (sql: string, ...args: SQLInputValue[]): Row | undefined =>
    db.prepare(sql).get(...args);
  const run = (sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).run(...args);
  const count = (sql: string, ...args: SQLInputValue[]) =>
    integer(get(sql, ...args)?.n, 0);
  const sessions = new Map<string, Session>();
  const requestSessions = new WeakMap<FastifyRequest, RequestSession>();
  const failures = new Map<string, { count: number; start: number }>();
  const token = () => randomBytes(32).toString("hex");
  const cookie = (value: string) =>
    `budget_session=${value}; Path=/; HttpOnly; SameSite=Strict${options.https ? "; Secure" : ""}`;
  const initialized = () =>
    !!get("SELECT value FROM settings WHERE key='password_hash'");

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Interner Fehler";
    const suppliedStatus = isObject(error) ? error.statusCode : undefined;
    const status =
      typeof suppliedStatus === "number" &&
      suppliedStatus >= 400 &&
      suppliedStatus < 600
        ? suppliedStatus
        : 400;
    reply.code(status).send({
      error:
        status >= 500
          ? "Interner Fehler"
          : message.includes("FOREIGN KEY")
            ? "Eintrag wird noch verwendet"
            : message.includes("UNIQUE")
              ? "Eintrag existiert bereits"
              : message,
    });
  });
  app.addHook("onRequest", async (req, reply) => {
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    const rawPath = req.url.split("?")[0];
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      throw new HttpError(400, "Ungültiger URL-Pfad");
    }
    requireThat(
      !path.includes("%") && !path.includes("\\"),
      "Ungültiger URL-Pfad",
    );
    const api = path.startsWith("/api/");
    if (api) reply.header("Cache-Control", "no-store");
    const sessionId = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("budget_session="))
      ?.slice(15);
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (session && now() - session.touched >= 30 * 60_000) {
      if (sessionId) sessions.delete(sessionId);
      session = undefined;
    }
    requestSessions.set(req, { session, id: sessionId });
    if (!api) return;
    if (path === "/api/auth" && req.method === "GET") {
      if (session) session.touched = now();
      return;
    }
    const publicAuth = path === "/api/auth/setup" || path === "/api/auth/login";
    if (!publicAuth) requireThat(session?.authenticated, "Bitte anmelden", 401);
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const csrf = req.headers["x-csrf-token"];
      requireThat(
        session &&
          typeof csrf === "string" &&
          /^[a-f0-9]{64}$/.test(csrf) &&
          timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)),
        "Ungültiger Sicherheitsschlüssel. Bitte neu laden.",
        403,
      );
      const origin = req.headers.origin;
      if (origin !== undefined) {
        const host = req.headers.host;
        requireThat(
          typeof host === "string" && !/[\s/@\\]/.test(host),
          "Ungültiger Host",
          403,
        );
        const expectedOrigin = `${options.https ? "https" : "http"}://${host}`;
        requireThat(
          typeof origin === "string" && origin === expectedOrigin,
          "Fremder Ursprung",
          403,
        );
      }
      requireThat(
        req.headers["sec-fetch-site"] !== "cross-site",
        "Fremder Ursprung",
        403,
      );
    }
    if (session) session.touched = now();
  });
  app.get("/api/auth", async (req, reply) => {
    let session = requestSessions.get(req)?.session;
    if (!session) {
      const sessionId = token();
      session = { csrf: token(), authenticated: false, touched: now() };
      sessions.set(sessionId, session);
      reply.header("Set-Cookie", cookie(sessionId));
    }
    return {
      initialized: initialized(),
      authenticated: session.authenticated,
      csrf: session.csrf,
    };
  });
  for (const mode of ["setup", "login"])
    app.post(`/api/auth/${mode}`, async (req, reply) => {
      const password = text(object(req.body).password);
      requireThat(
        password.length >= 10,
        "Passwort muss mindestens 10 Zeichen haben",
      );
      if (mode === "setup") {
        requireThat(!initialized(), "Passwort wurde bereits gesetzt", 409);
        const hash = await bcrypt.hash(password, 12);
        atomic(db, () => {
          requireThat(!initialized(), "Passwort wurde bereits gesetzt", 409);
          run(
            "INSERT INTO settings(key,value) VALUES('password_hash',?)",
            hash,
          );
        });
      } else {
        const failure = failures.get(req.ip);
        if (failure && now() - failure.start >= 900_000)
          failures.delete(req.ip);
        requireThat(
          (failures.get(req.ip)?.count ?? 0) < 5,
          "Zu viele Login-Versuche. Nach 15 Minuten erneut versuchen.",
          429,
        );
        const storedHash = get(
          "SELECT value FROM settings WHERE key='password_hash'",
        )?.value;
        if (
          storedHash === undefined ||
          !(await bcrypt.compare(password, string(storedHash)))
        ) {
          const old = failures.get(req.ip);
          failures.set(req.ip, {
            count: (old?.count ?? 0) + 1,
            start: old?.start ?? now(),
          });
          throw new HttpError(401, "Passwort ist falsch");
        }
        failures.delete(req.ip);
      }
      const oldId = requestSessions.get(req)?.id;
      if (oldId) sessions.delete(oldId);
      const sessionId = token(),
        session = { csrf: token(), authenticated: true, touched: now() };
      sessions.set(sessionId, session);
      reply.header("Set-Cookie", cookie(sessionId));
      return { authenticated: true, csrf: session.csrf };
    });
  app.post("/api/auth/logout", async (req, reply) => {
    const sessionId = requestSessions.get(req)?.id;
    if (sessionId) sessions.delete(sessionId);
    reply.header("Set-Cookie", `${cookie("")}; Max-Age=0`);
    return { ok: true };
  });

  const category = (value: unknown, budgetable = false): Category => {
    const row = get("SELECT * FROM category WHERE id=?", id(value));
    requireThat(row, "Kategorie nicht gefunden", 404);
    const result = categoryRow(row);
    if (budgetable)
      requireThat(
        !result.is_income && !result.is_excluded,
        "Kategorie ist nicht budgetierbar",
      );
    return result;
  };
  const txs = () => all("SELECT * FROM transactions").map(transactionRow);
  const cats = () =>
    all("SELECT * FROM category ORDER BY sort_order,id").map(categoryRow);
  const rules = () =>
    all("SELECT * FROM rule ORDER BY priority,id").map(ruleRow);
  const budgets = () => all("SELECT * FROM budget").map(budgetRow);
  const recurringItems = () =>
    all("SELECT * FROM recurring_item").map(recurringRow);
  const pairs = () => all("SELECT * FROM transfer_pair").map(pairRow);
  const matchedTransactionIds = () =>
    new Set(
      all(
        "SELECT matched_transaction_id FROM recurring_occurrence WHERE matched_transaction_id IS NOT NULL",
      ).map((row) => id(row.matched_transaction_id)),
    );
  const protectedTransactionIds = () => {
    const result = matchedTransactionIds();
    for (const pair of pairs()) {
      result.add(pair.outgoing_transaction_id);
      result.add(pair.incoming_transaction_id);
    }
    return result;
  };
  const transferCategoryUsed = (categoryId: number) =>
    !!get(
      "SELECT t.id FROM transactions t JOIN transfer_pair p ON t.id=p.outgoing_transaction_id OR t.id=p.incoming_transaction_id WHERE t.category_id=? LIMIT 1",
      categoryId,
    );
  function requireUnmatched(transactionId: number) {
    requireThat(
      !get(
        "SELECT id FROM transfer_pair WHERE outgoing_transaction_id=? OR incoming_transaction_id=?",
        transactionId,
        transactionId,
      ),
      "Umbuchung erst aufheben",
    );
    requireThat(
      !get(
        "SELECT id FROM recurring_occurrence WHERE matched_transaction_id=?",
        transactionId,
      ),
      "Zahlungsabgleich erst aufheben",
    );
  }

  app.get("/api/state", async () => ({
    accounts: all("SELECT * FROM account"),
    categories: cats(),
    rules: rules(),
    recurring_items: recurringItems(),
    profiles: all("SELECT * FROM import_profile").map((profile) => ({
      ...profile,
      config: parserConfig(
        JSON.parse(string(profile.config, Number.MAX_SAFE_INTEGER)),
      ),
    })),
    setup: {
      ...get("SELECT step,complete FROM setup_progress WHERE id=1"),
      skipped_groups: textList(
        JSON.parse(
          string(
            get("SELECT value FROM settings WHERE key='setup_skipped_groups'")
              ?.value ?? "[]",
            Number.MAX_SAFE_INTEGER,
          ),
        ),
      ),
      skipped_history: textList(
        JSON.parse(
          string(
            get("SELECT value FROM settings WHERE key='setup_skipped_history'")
              ?.value ?? "[]",
            Number.MAX_SAFE_INTEGER,
          ),
        ),
      ),
    },
  }));
  function accountInput(value: unknown) {
    const body = object(value);
    return {
      name: text(body.name),
      type: choice(body.type, [
        "Giro",
        "Tagesgeld",
        "Kreditkarte",
        "sonstiges",
      ]),
    };
  }
  app.post("/api/accounts", async (req) => {
    const body = accountInput(req.body);
    return {
      id: Number(
        run("INSERT INTO account(name,type) VALUES(?,?)", body.name, body.type)
          .lastInsertRowid,
      ),
    };
  });
  app.put("/api/accounts/:id", async (req) => {
    const body = accountInput(req.body);
    run(
      "UPDATE account SET name=?,type=? WHERE id=?",
      body.name,
      body.type,
      parameterId(req.params),
    );
    return { ok: true };
  });
  app.delete("/api/accounts/:id", async (req) => {
    const accountId = parameterId(req.params);
    requireThat(
      !get("SELECT id FROM transactions WHERE account_id=? LIMIT 1", accountId),
      "Konto enthält Buchungen",
    );
    atomic(db, () => {
      run("DELETE FROM imports WHERE account_id=?", accountId);
      run("DELETE FROM account WHERE id=?", accountId);
    });
    return { ok: true };
  });
  function categoryValues(value: unknown): SQLInputValue[] {
    const body = object(value),
      income = flag(body.is_income),
      excluded = flag(body.is_excluded),
      carry = flag(body.carryover_enabled);
    requireThat(
      !(income && excluded) && !((income || excluded) && carry),
      "Unvereinbare Kategorie-Flags",
    );
    return [
      text(body.name),
      body.sort_order === undefined ? 0 : integer(body.sort_order),
      carry,
      income,
      excluded,
    ];
  }
  app.post("/api/categories", async (req) => ({
    id: Number(
      run(
        "INSERT INTO category(name,sort_order,carryover_enabled,is_income,is_excluded) VALUES(?,?,?,?,?)",
        ...categoryValues(req.body),
      ).lastInsertRowid,
    ),
  }));
  app.put("/api/categories/:id", async (req) => {
    const categoryId = parameterId(req.params),
      body = object(req.body),
      values = categoryValues(body);
    category(categoryId);
    const income = flag(body.is_income),
      excluded = flag(body.is_excluded);
    if (income || excluded)
      requireThat(
        !get(
          "SELECT id FROM budget WHERE category_id=? UNION ALL SELECT id FROM recurring_item WHERE category_id=? UNION ALL SELECT id FROM recurring_occurrence WHERE category_id=? LIMIT 1",
          categoryId,
          categoryId,
          categoryId,
        ),
        "Kategorie hat Budgets oder feste Posten",
      );
    if (transferCategoryUsed(categoryId))
      requireThat(
        excluded === 1 && income === 0,
        "Bestätigte Umbuchungen benötigen eine ausgeschlossene Kategorie",
      );
    run(
      "UPDATE category SET name=?,sort_order=?,carryover_enabled=?,is_income=?,is_excluded=? WHERE id=?",
      ...values,
      categoryId,
    );
    return { ok: true };
  });
  app.delete("/api/categories/:id", async (req) =>
    atomic(db, () => {
      const categoryId = parameterId(req.params),
        old = category(categoryId);
      const body = req.body === undefined ? {} : object(req.body);
      const tables = [
        "transactions",
        "rule",
        "budget",
        "recurring_item",
        "recurring_occurrence",
      ];
      const references =
        tables.some((table) =>
          get(
            `SELECT id FROM ${table} WHERE category_id=? LIMIT 1`,
            categoryId,
          ),
        ) ||
        !!get(
          "SELECT id FROM recurring_occurrence WHERE previous_category_id=? LIMIT 1",
          categoryId,
        ) ||
        !!get(
          "SELECT id FROM transfer_pair WHERE outgoing_previous_category_id=? OR incoming_previous_category_id=? LIMIT 1",
          categoryId,
          categoryId,
        );
      if (body.replacement_id !== undefined && body.replacement_id !== null)
        id(body.replacement_id);
      if (references) {
        const replacementId = id(body.replacement_id);
        requireThat(
          replacementId !== categoryId,
          "Ersatzkategorie erforderlich",
        );
        const replacement = category(replacementId);
        requireThat(
          old.is_income === replacement.is_income &&
            old.is_excluded === replacement.is_excluded,
          "Ersatzkategorie muss denselben Typ haben",
        );
        if (transferCategoryUsed(categoryId))
          requireThat(
            replacement.is_excluded === 1 && !replacement.is_income,
            "Bestätigte Umbuchungen benötigen eine ausgeschlossene Kategorie",
          );
        if (
          ["budget", "recurring_item", "recurring_occurrence"].some((table) =>
            get(
              `SELECT id FROM ${table} WHERE category_id=? LIMIT 1`,
              categoryId,
            ),
          )
        )
          category(replacementId, true);
        for (const entry of all(
          "SELECT * FROM budget WHERE category_id=?",
          categoryId,
        ).map(budgetRow)) {
          run(
            "INSERT INTO budget(month,category_id,amount_cents) VALUES(?,?,?) ON CONFLICT(month,category_id) DO UPDATE SET amount_cents=amount_cents+excluded.amount_cents",
            entry.month,
            replacementId,
            entry.amount_cents,
          );
        }
        run("DELETE FROM budget WHERE category_id=?", categoryId);
        for (const table of [
          "transactions",
          "rule",
          "recurring_item",
          "recurring_occurrence",
        ])
          run(
            `UPDATE ${table} SET category_id=? WHERE category_id=?`,
            replacementId,
            categoryId,
          );
        run(
          "UPDATE recurring_occurrence SET previous_category_id=? WHERE previous_category_id=?",
          replacementId,
          categoryId,
        );
        run(
          "UPDATE transfer_pair SET outgoing_previous_category_id=? WHERE outgoing_previous_category_id=?",
          replacementId,
          categoryId,
        );
        run(
          "UPDATE transfer_pair SET incoming_previous_category_id=? WHERE incoming_previous_category_id=?",
          replacementId,
          categoryId,
        );
      }
      run("DELETE FROM category WHERE id=?", categoryId);
      return { ok: true };
    }),
  );

  app.get("/api/transactions", async (req) => {
    const query = object(req.query),
      where: string[] = [],
      args: SQLInputValue[] = [];
    if (query.month !== undefined && query.month !== "") {
      where.push("substr(booking_date,1,7)=?");
      args.push(month(query.month));
    }
    const accountId = optionalQueryId(query.account_id),
      categoryId = optionalQueryId(query.category_id);
    if (accountId !== undefined) {
      where.push("account_id=?");
      args.push(accountId);
    }
    if (categoryId !== undefined) {
      where.push("category_id=?");
      args.push(categoryId);
    }
    if (query.uncategorized !== undefined) {
      const uncategorized = choice(query.uncategorized, ["0", "1", ""]);
      if (uncategorized === "1") where.push("category_id IS NULL");
    }
    if (query.text !== undefined) {
      const search = string(query.text);
      if (search) {
        where.push(
          "(instr(lower(counterparty),lower(?))>0 OR instr(lower(purpose),lower(?))>0)",
        );
        args.push(search, search);
      }
    }
    const clause = where.length ? " WHERE " + where.join(" AND ") : "";
    const page =
      query.page === undefined || query.page === ""
        ? 0
        : queryInteger(query.page, 0);
    requireThat(Number.isSafeInteger(page * 50), "Ungültige Seite");
    return {
      rows: all(
        `SELECT * FROM transactions${clause} ORDER BY booking_date DESC,id DESC LIMIT 50 OFFSET ?`,
        ...args,
        page * 50,
      ),
      total: count(`SELECT count(*) n FROM transactions${clause}`, ...args),
    };
  });
  app.post("/api/transactions/:id/category", async (req) => {
    const transactionId = parameterId(req.params),
      categoryId = nullableId(object(req.body).category_id);
    if (categoryId !== null) category(categoryId);
    requireUnmatched(transactionId);
    run(
      "UPDATE transactions SET category_id=?,category_source=? WHERE id=?",
      categoryId,
      categoryId === null ? null : "manual",
      transactionId,
    );
    return { ok: true };
  });
  function ruleValues(value: unknown): SQLInputValue[] {
    const body = object(value),
      target = category(body.category_id);
    return [
      text(body.match_text),
      choice(body.match_field, ["counterparty", "purpose", "both"]),
      target.id,
      integer(body.priority),
    ];
  }
  app.post("/api/rules", async (req) => ({
    id: Number(
      run(
        "INSERT INTO rule(match_text,match_field,category_id,priority) VALUES(?,?,?,?)",
        ...ruleValues(req.body),
      ).lastInsertRowid,
    ),
  }));
  app.put("/api/rules/:id", async (req) => {
    run(
      "UPDATE rule SET match_text=?,match_field=?,category_id=?,priority=? WHERE id=?",
      ...ruleValues(req.body),
      parameterId(req.params),
    );
    return { ok: true };
  });
  app.delete("/api/rules/:id", async (req) => {
    run("DELETE FROM rule WHERE id=?", parameterId(req.params));
    return { ok: true };
  });
  app.post("/api/rules/apply", async (req) =>
    atomic(db, () => {
      const confirm = boolean(object(req.body).confirm),
        currentRules = rules(),
        protectedIds = protectedTransactionIds();
      const changes = txs()
        .filter(
          (transaction) =>
            transaction.category_source !== "manual" &&
            !protectedIds.has(transaction.id),
        )
        .flatMap((transaction) => {
          const categoryId = matchRule(transaction, currentRules);
          return categoryId !== transaction.category_id
            ? [
                {
                  id: transaction.id,
                  category_id: categoryId,
                  previous_category_id: transaction.category_id,
                },
              ]
            : [];
        });
      if (confirm)
        for (const change of changes)
          run(
            "UPDATE transactions SET category_id=?,category_source=? WHERE id=?",
            change.category_id,
            change.category_id === null ? null : "rule",
            change.id,
          );
      return { changes };
    }),
  );
  app.post("/api/budgets", async (req) =>
    atomic(db, () => {
      const body = object(req.body),
        targetMonth = month(body.month);
      const amounts = list(body.amounts);
      const replace =
        body.replace === undefined ? false : boolean(body.replace);
      for (const raw of amounts) {
        const amount = object(raw),
          categoryId = category(amount.category_id, true).id,
          cents = integer(amount.amount_cents, 0);
        if (
          get(
            "SELECT id FROM budget WHERE month=? AND category_id=?",
            targetMonth,
            categoryId,
          )
        )
          requireThat(replace, "Bestehendes Budget ausdrücklich ersetzen", 409);
        run(
          "INSERT INTO budget(month,category_id,amount_cents) VALUES(?,?,?) ON CONFLICT(month,category_id) DO UPDATE SET amount_cents=excluded.amount_cents",
          targetMonth,
          categoryId,
          cents,
        );
      }
      return { ok: true };
    }),
  );

  function importInput(value: unknown) {
    const body = object(value),
      accountId = id(body.account_id);
    requireThat(
      get("SELECT id FROM account WHERE id=?", accountId),
      "Konto nicht gefunden",
    );
    const content = string(body.content_base64, 24 * 1024 * 1024);
    requireThat(
      content.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(content),
      "Ungültige Base64-Datei",
    );
    const config = parserConfig(body.config);
    const parserId =
      body.parser_id === undefined
        ? "generic"
        : choice(body.parser_id, ["generic", "ing-de", "sparkasse-camt52"]);
    return {
      account_id: accountId,
      config,
      parser_id: parserId,
      rows: parserRegistry
        .get(parserId)
        .parse(Buffer.from(content, "base64"), config),
    };
  }
  app.put("/api/profiles/:id", async (req) => {
    const accountId = parameterId(req.params),
      config = parserConfig(object(req.body).config);
    requireThat(
      get("SELECT id FROM account WHERE id=?", accountId),
      "Konto nicht gefunden",
    );
    run(
      "INSERT INTO import_profile(account_id,config) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config",
      accountId,
      JSON.stringify(config),
    );
    return { ok: true };
  });
  app.delete("/api/profiles/:id", async (req) => {
    run(
      "DELETE FROM import_profile WHERE account_id=?",
      parameterId(req.params),
    );
    return { ok: true };
  });
  app.post("/api/import/preview", async (req) => ({
    rows: importInput(req.body).rows.slice(0, 10),
  }));
  app.post("/api/import/confirm", async (req) => {
    const body = object(req.body),
      filename = text(body.filename),
      input = importInput(body);
    return atomic(db, () => {
      const importId = Number(
        run(
          "INSERT INTO imports(account_id,filename,parser_id,rows_new,rows_skipped) VALUES(?,?,?,0,0)",
          input.account_id,
          filename,
          input.parser_id,
        ).lastInsertRowid,
      );
      const occurrences = new Map<string, number>();
      let added = 0,
        uncategorized = 0;
      const currentRules = rules();
      for (const row of input.rows) {
        const hash = createHash("sha256")
          .update(
            JSON.stringify([
              input.account_id,
              row.booking_date,
              row.amount_cents,
              row.counterparty,
              row.purpose,
            ]),
          )
          .digest("hex");
        const occurrence = (occurrences.get(hash) ?? 0) + 1;
        occurrences.set(hash, occurrence);
        if (
          get(
            "SELECT id FROM transactions WHERE dedup_hash=? AND dedup_occurrence=?",
            hash,
            occurrence,
          )
        )
          continue;
        const categoryId = matchRule(row, currentRules);
        run(
          "INSERT INTO transactions(account_id,booking_date,amount_cents,counterparty,purpose,category_id,category_source,import_id,dedup_hash,dedup_occurrence) VALUES(?,?,?,?,?,?,?,?,?,?)",
          input.account_id,
          row.booking_date,
          row.amount_cents,
          row.counterparty,
          row.purpose,
          categoryId,
          categoryId === null ? null : "rule",
          importId,
          hash,
          occurrence,
        );
        added++;
        if (categoryId === null) uncategorized++;
      }
      run(
        "UPDATE imports SET rows_new=?,rows_skipped=? WHERE id=?",
        added,
        input.rows.length - added,
        importId,
      );
      run(
        "INSERT INTO import_profile(account_id,config) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET config=excluded.config",
        input.account_id,
        JSON.stringify(input.config),
      );
      return {
        new_count: added,
        skipped_count: input.rows.length - added,
        uncategorized_count: uncategorized,
      };
    });
  });
  function ensureOccurrences(targetMonth: string) {
    for (const item of recurringItems())
      for (const due of recurringDates(
        item.first_due_date,
        item.interval,
        targetMonth,
      )) {
        run(
          "INSERT OR IGNORE INTO recurring_occurrence(recurring_item_id,due_date,amount_cents,category_id) VALUES(?,?,?,?)",
          item.id,
          due,
          item.amount_cents,
          item.category_id,
        );
      }
  }
  app.get("/api/dashboard", async (req) => {
    const query = object(req.query),
      targetMonth = month(query.month ?? currentMonth()),
      accountId = optionalQueryId(query.account_id);
    ensureOccurrences(targetMonth);
    const result = dashboard(targetMonth, cats(), txs(), budgets(), accountId);
    return {
      ...result,
      categories: result.categories.map((entry) => {
        const planned = count(
          "SELECT coalesce(sum(amount_cents),0) n FROM recurring_occurrence WHERE category_id=? AND substr(due_date,1,7)=? AND matched_transaction_id IS NULL",
          entry.id,
          targetMonth,
        );
        return {
          ...entry,
          planned_cents: planned,
          free_cents: entry.remaining_cents - planned,
        };
      }),
    };
  });

  function transferData() {
    const transactions = txs(),
      currentPairs = pairs(),
      used = matchedTransactionIds();
    for (const pair of currentPairs) {
      used.add(pair.outgoing_transaction_id);
      used.add(pair.incoming_transaction_id);
    }
    const incomingByAmount = new Map<number, Transaction[]>();
    for (const transaction of transactions) {
      if (transaction.amount_cents <= 0 || used.has(transaction.id)) continue;
      const bucket = incomingByAmount.get(transaction.amount_cents);
      if (bucket) bucket.push(transaction);
      else incomingByAmount.set(transaction.amount_cents, [transaction]);
    }
    const byId = new Map(
      transactions.map((transaction) => [transaction.id, transaction]),
    );
    return {
      suggestions: transactions
        .filter(
          (transaction) =>
            transaction.amount_cents < 0 && !used.has(transaction.id),
        )
        .flatMap((outgoing) =>
          (incomingByAmount.get(-outgoing.amount_cents) ?? [])
            .filter(
              (incoming) =>
                incoming.account_id !== outgoing.account_id &&
                Math.abs(
                  Date.parse(incoming.booking_date) -
                    Date.parse(outgoing.booking_date),
                ) <=
                  3 * 86400000,
            )
            .map((incoming) => ({ outgoing, incoming })),
        ),
      pairs: currentPairs.map((pair) => ({
        id: pair.id,
        outgoing: byId.get(pair.outgoing_transaction_id),
        incoming: byId.get(pair.incoming_transaction_id),
      })),
    };
  }
  app.get("/api/transfers", async () => transferData());
  app.post("/api/transfers", async (req) =>
    atomic(db, () => {
      const body = object(req.body),
        outgoingId = id(body.outgoing_id),
        incomingId = id(body.incoming_id),
        target = category(body.category_id);
      requireThat(
        target.is_excluded && !target.is_income,
        "Ausgeschlossene Kategorie erforderlich",
      );
      requireUnmatched(outgoingId);
      requireUnmatched(incomingId);
      const pair = transferData().suggestions.find(
        (candidate) =>
          candidate.outgoing.id === outgoingId &&
          candidate.incoming.id === incomingId,
      );
      requireThat(pair, "Umbuchungspaar ungültig oder bereits zugeordnet");
      const pairId = Number(
        run(
          "INSERT INTO transfer_pair(outgoing_transaction_id,incoming_transaction_id,outgoing_previous_category_id,outgoing_previous_category_source,incoming_previous_category_id,incoming_previous_category_source) VALUES(?,?,?,?,?,?)",
          outgoingId,
          incomingId,
          pair.outgoing.category_id,
          pair.outgoing.category_source,
          pair.incoming.category_id,
          pair.incoming.category_source,
        ).lastInsertRowid,
      );
      run(
        "UPDATE transactions SET category_id=?,category_source='manual' WHERE id IN (?,?)",
        target.id,
        outgoingId,
        incomingId,
      );
      return { id: pairId };
    }),
  );
  app.delete("/api/transfers/:id", async (req) =>
    atomic(db, () => {
      const pairId = parameterId(req.params),
        row = get("SELECT * FROM transfer_pair WHERE id=?", pairId);
      requireThat(row, "Paar nicht gefunden", 404);
      const pair = pairRow(row);
      run(
        "UPDATE transactions SET category_id=?,category_source=? WHERE id=?",
        nullableId(row.outgoing_previous_category_id),
        row.outgoing_previous_category_source === null
          ? null
          : choice(row.outgoing_previous_category_source, ["manual", "rule"]),
        pair.outgoing_transaction_id,
      );
      run(
        "UPDATE transactions SET category_id=?,category_source=? WHERE id=?",
        nullableId(row.incoming_previous_category_id),
        row.incoming_previous_category_source === null
          ? null
          : choice(row.incoming_previous_category_source, ["manual", "rule"]),
        pair.incoming_transaction_id,
      );
      run("DELETE FROM transfer_pair WHERE id=?", pairId);
      return { ok: true };
    }),
  );

  function recurringValues(value: unknown): SQLInputValue[] {
    const body = object(value),
      categoryId = category(body.category_id, true).id;
    return [
      text(body.name),
      integer(body.amount_cents, 1),
      choice(body.interval, ["monthly", "quarterly", "yearly"]),
      date(body.first_due_date),
      categoryId,
      body.counterparty_hint === undefined
        ? ""
        : string(body.counterparty_hint),
    ];
  }
  app.post("/api/recurring-items", async (req) => ({
    id: Number(
      run(
        "INSERT INTO recurring_item(name,amount_cents,interval,first_due_date,category_id,counterparty_hint) VALUES(?,?,?,?,?,?)",
        ...recurringValues(req.body),
      ).lastInsertRowid,
    ),
  }));
  app.put("/api/recurring-items/:id", async (req) =>
    atomic(db, () => {
      const itemId = parameterId(req.params),
        values = recurringValues(req.body);
      run(
        "DELETE FROM recurring_occurrence WHERE recurring_item_id=? AND matched_transaction_id IS NULL",
        itemId,
      );
      run(
        "UPDATE recurring_item SET name=?,amount_cents=?,interval=?,first_due_date=?,category_id=?,counterparty_hint=? WHERE id=?",
        ...values,
        itemId,
      );
      return { ok: true };
    }),
  );
  app.delete("/api/recurring-items/:id", async (req) => {
    const itemId = parameterId(req.params);
    requireThat(
      !get(
        "SELECT id FROM recurring_occurrence WHERE recurring_item_id=? AND matched_transaction_id IS NOT NULL",
        itemId,
      ),
      "Bestätigte Zahlungen erst aufheben",
    );
    run("DELETE FROM recurring_item WHERE id=?", itemId);
    return { ok: true };
  });
  function recurringData(targetMonth: string) {
    ensureOccurrences(targetMonth);
    const occurrences = all(
      "SELECT o.*,i.name,i.counterparty_hint FROM recurring_occurrence o JOIN recurring_item i ON i.id=o.recurring_item_id WHERE substr(o.due_date,1,7)=? ORDER BY due_date",
      targetMonth,
    ).map((row) => ({
      ...occurrenceRow(row),
      name: text(row.name),
      counterparty_hint: string(row.counterparty_hint),
    }));
    const excluded = new Set(
      cats()
        .filter((entry) => entry.is_excluded)
        .map((entry) => entry.id),
    );
    const used = protectedTransactionIds();
    const candidates = txs().filter(
      (transaction) =>
        transaction.amount_cents < 0 &&
        !used.has(transaction.id) &&
        (transaction.category_id === null ||
          !excluded.has(transaction.category_id)),
    );
    const suggestions = occurrences
      .filter(
        (occurrence) =>
          occurrence.matched_transaction_id === null &&
          occurrence.counterparty_hint.trim(),
      )
      .flatMap((occurrence) =>
        candidates
          .filter(
            (transaction) =>
              normalizeParty(transaction.counterparty) ===
                normalizeParty(occurrence.counterparty_hint) &&
              Math.abs(-transaction.amount_cents - occurrence.amount_cents) *
                100 <=
                occurrence.amount_cents * 5 &&
              Math.abs(
                Date.parse(transaction.booking_date) -
                  Date.parse(occurrence.due_date),
              ) <=
                7 * 86400000,
          )
          .map((transaction) => ({
            occurrence_id: occurrence.id,
            transaction,
          })),
      );
    return { occurrences, suggestions };
  }
  app.get("/api/recurring", async (req) =>
    recurringData(month(object(req.query).month ?? currentMonth())),
  );
  app.post("/api/recurring/match", async (req) =>
    atomic(db, () => {
      const body = object(req.body),
        occurrenceId = id(body.occurrence_id),
        transactionId = id(body.transaction_id);
      const confirmCategory = boolean(body.confirm_category);
      const row = get(
        "SELECT * FROM recurring_occurrence WHERE id=?",
        occurrenceId,
      );
      requireThat(row, "Fälligkeit nicht gefunden", 404);
      const occurrence = occurrenceRow(row);
      requireUnmatched(transactionId);
      const suggestion = recurringData(
        occurrence.due_date.slice(0, 7),
      ).suggestions.find(
        (candidate) =>
          candidate.occurrence_id === occurrence.id &&
          candidate.transaction.id === transactionId,
      );
      requireThat(suggestion, "Keine passende offene Zahlung");
      category(occurrence.category_id, true);
      run(
        "UPDATE recurring_occurrence SET matched_transaction_id=?,previous_category_id=?,previous_category_source=? WHERE id=?",
        transactionId,
        suggestion.transaction.category_id,
        suggestion.transaction.category_source,
        occurrence.id,
      );
      if (confirmCategory)
        run(
          "UPDATE transactions SET category_id=?,category_source='manual' WHERE id=?",
          occurrence.category_id,
          transactionId,
        );
      return { ok: true };
    }),
  );
  app.delete("/api/recurring/match/:id", async (req) =>
    atomic(db, () => {
      const occurrenceId = parameterId(req.params),
        row = get(
          "SELECT * FROM recurring_occurrence WHERE id=?",
          occurrenceId,
        );
      if (row && row.matched_transaction_id !== null) {
        run(
          "UPDATE transactions SET category_id=?,category_source=? WHERE id=?",
          nullableId(row.previous_category_id),
          row.previous_category_source === null
            ? null
            : choice(row.previous_category_source, ["manual", "rule"]),
          id(row.matched_transaction_id),
        );
        run(
          "UPDATE recurring_occurrence SET matched_transaction_id=NULL,previous_category_id=NULL,previous_category_source=NULL WHERE id=?",
          occurrenceId,
        );
      }
      return { ok: true };
    }),
  );

  function setupSuggestions() {
    const groups = new Map<string, SetupGroup>(),
      categories = cats(),
      protectedIds = protectedTransactionIds(),
      transactions = txs();
    const confirmed = new Set(
      all("SELECT key FROM setup_action").map((row) => string(row.key)),
    );
    const eligible = new Set(
      transactions
        .filter(
          (transaction) =>
            transaction.category_source !== "manual" &&
            !protectedIds.has(transaction.id),
        )
        .map((transaction) => transaction.id),
    );
    for (const transaction of transactions) {
      if (
        !eligible.has(transaction.id) ||
        confirmed.has("group-tx:" + transaction.id)
      )
        continue;
      const key = normalizeHistoryParty(transaction.counterparty);
      if (!key) continue;
      const group: SetupGroup = groups.get(key) ?? {
        key,
        name: key,
        transaction_ids: [],
        count: 0,
        total_cents: 0,
        match_text: key,
        suggested_category_id: null,
      };
      group.transaction_ids.push(transaction.id);
      group.count++;
      group.total_cents += Math.abs(transaction.amount_cents);
      groups.set(key, group);
    }
    for (const group of groups.values())
      group.suggested_category_id = suggestCategory(group.key, categories);
    const history = detectHistory(transactions);
    const incomeEligible = new Set(
      [...eligible].filter(
        (transactionId) => !confirmed.has("income-tx:" + transactionId),
      ),
    );
    return {
      groups: [...groups.values()].sort(
        (left, right) =>
          right.total_cents - left.total_cents || right.count - left.count,
      ),
      history: {
        income: history.income.filter((candidate) =>
          candidate.transaction_ids.some((transactionId) =>
            incomeEligible.has(transactionId),
          ),
        ),
        recurring: history.recurring.filter(
          (candidate) => !confirmed.has("recurring:" + candidate.key),
        ),
      },
    };
  }
  app.get("/api/setup/suggestions", async () => setupSuggestions());
  app.get("/api/setup/group-preview", async (req) => {
    const query = object(req.query),
      key = text(query.key),
      search = text(query.match_text);
    requireThat(
      setupSuggestions().groups.some((group) => group.key === key),
      "Gruppe nicht vorhanden",
    );
    const rows = txs().filter((transaction) =>
      transaction.counterparty.toUpperCase().includes(search.toUpperCase()),
    );
    return { rows, total: rows.length };
  });
  app.put("/api/setup", async (req) =>
    atomic(db, () => {
      const body = object(req.body),
        step = integer(body.step, 0, 7),
        complete = body.complete === undefined ? false : boolean(body.complete);
      const skippedGroups =
        body.skipped_groups === undefined
          ? undefined
          : textList(body.skipped_groups);
      const skippedHistory =
        body.skipped_history === undefined
          ? undefined
          : textList(body.skipped_history);
      run(
        "UPDATE setup_progress SET step=?,complete=? WHERE id=1",
        step,
        Number(complete),
      );
      if (skippedGroups !== undefined)
        run(
          "INSERT INTO settings(key,value) VALUES('setup_skipped_groups',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          JSON.stringify(skippedGroups),
        );
      if (skippedHistory !== undefined)
        run(
          "INSERT INTO settings(key,value) VALUES('setup_skipped_history',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          JSON.stringify(skippedHistory),
        );
      return { ok: true };
    }),
  );
  app.post("/api/setup/group", async (req) =>
    atomic(db, () => {
      const body = object(req.body),
        key = text(body.key),
        search = text(body.match_text),
        categoryId = category(body.category_id).id;
      requireThat(boolean(body.confirm), "Zuordnung ausdrücklich bestätigen");
      const group = setupSuggestions().groups.find(
        (candidate) => candidate.key === key,
      );
      if (!group) {
        requireThat(
          get("SELECT key FROM setup_action WHERE key=?", "group:" + key),
          "Gruppe nicht vorhanden",
        );
        return { ok: true };
      }
      for (const transactionId of group.transaction_ids) {
        run(
          "UPDATE transactions SET category_id=?,category_source='manual' WHERE id=? AND coalesce(category_source,'')!='manual'",
          categoryId,
          transactionId,
        );
        run(
          "INSERT OR IGNORE INTO setup_action(key) VALUES(?)",
          "group-tx:" + transactionId,
        );
      }
      if (
        !get(
          "SELECT id FROM rule WHERE lower(match_text)=lower(?) AND match_field='counterparty' AND category_id=? LIMIT 1",
          search,
          categoryId,
        )
      )
        run(
          "INSERT INTO rule(match_text,match_field,category_id,priority) VALUES(?,'counterparty',?,0)",
          search,
          categoryId,
        );
      run("INSERT OR IGNORE INTO setup_action(key) VALUES(?)", "group:" + key);
      return { ok: true };
    }),
  );
  app.post("/api/setup/history", async (req) =>
    atomic(db, () => {
      const body = object(req.body),
        kind = choice(body.kind, ["income", "recurring"]),
        key = text(body.key),
        categoryId = id(body.category_id);
      const name = body.name === undefined ? undefined : text(body.name);
      const amount =
        body.amount_cents === undefined
          ? undefined
          : integer(body.amount_cents, 1);
      const firstDate =
        body.first_due_date === undefined
          ? undefined
          : date(body.first_due_date);
      const counterpartyHint =
        body.counterparty_hint === undefined
          ? undefined
          : string(body.counterparty_hint);
      const action = kind + ":" + key;
      if (
        kind === "recurring" &&
        get("SELECT key FROM setup_action WHERE key=?", action)
      )
        return { ok: true };
      const transactions = txs(),
        history = detectHistory(transactions);
      if (kind === "income") {
        const candidate = history.income.find(
          (suggestion) => suggestion.key === key,
        );
        requireThat(candidate, "Vorschlag nicht vorhanden");
        requireThat(
          category(categoryId).is_income,
          "Einkommenskategorie erforderlich",
        );
        const protectedIds = protectedTransactionIds();
        const candidateIds = new Set(candidate.transaction_ids);
        for (const transaction of transactions) {
          if (
            !candidateIds.has(transaction.id) ||
            transaction.category_source === "manual" ||
            protectedIds.has(transaction.id) ||
            get(
              "SELECT key FROM setup_action WHERE key=?",
              "income-tx:" + transaction.id,
            )
          )
            continue;
          run(
            "UPDATE transactions SET category_id=?,category_source='manual' WHERE id=?",
            categoryId,
            transaction.id,
          );
          run(
            "INSERT INTO setup_action(key) VALUES(?)",
            "income-tx:" + transaction.id,
          );
        }
      } else {
        const candidate = history.recurring.find(
          (suggestion) => suggestion.key === key,
        );
        requireThat(candidate, "Vorschlag nicht vorhanden");
        const candidateIds = new Set(candidate.transaction_ids);
        const latest = transactions
          .filter((transaction) => candidateIds.has(transaction.id))
          .sort(
            (left, right) =>
              right.booking_date.localeCompare(left.booking_date) ||
              right.id - left.id,
          )[0];
        requireThat(latest, "Vorschlag enthält keine Buchungen");
        run(
          "INSERT INTO recurring_item(name,amount_cents,interval,first_due_date,category_id,counterparty_hint) VALUES(?,?,?,?,?,?)",
          ...recurringValues({
            name: name ?? candidate.counterparty,
            amount_cents: amount ?? candidate.amount_cents,
            interval: "monthly",
            first_due_date: firstDate ?? candidate.first_due_date,
            category_id: categoryId,
            counterparty_hint: counterpartyHint ?? latest.counterparty,
          }),
        );
      }
      run("INSERT OR IGNORE INTO setup_action VALUES(?)", action);
      return { ok: true };
    }),
  );
  app.get("/api/setup/budget", async (req) => {
    const query = object(req.query);
    return {
      amounts: startBudgets(month(query.from), month(query.to), cats(), txs()),
    };
  });
  app.get("/api/setup/summary", async () => ({
    transactions: count("SELECT count(*) n FROM transactions"),
    categories: cats().length,
    rules: rules().length,
    income: count(
      "SELECT count(*) n FROM transactions t JOIN category c ON c.id=t.category_id WHERE c.is_income=1 AND amount_cents>0",
    ),
    recurring: count("SELECT count(*) n FROM recurring_item"),
    uncategorized: count(
      "SELECT count(*) n FROM transactions WHERE category_id IS NULL",
    ),
  }));
  await app.register(staticFiles, {
    root: fileURLToPath(new URL("../public", import.meta.url)),
    index: ["index.html"],
  });
  app.addHook("onClose", async () => {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  });
  return app;
}
