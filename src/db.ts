import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
export function openDatabase(path: string) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS migration(version INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS account(id INTEGER PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('Giro','Tagesgeld','Kreditkarte','sonstiges')));
  CREATE TABLE IF NOT EXISTS category(id INTEGER PRIMARY KEY,name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,carryover_enabled INTEGER NOT NULL DEFAULT 0,is_income INTEGER NOT NULL DEFAULT 0,is_excluded INTEGER NOT NULL DEFAULT 0,CHECK(NOT(is_income AND is_excluded)),CHECK(NOT((is_income OR is_excluded) AND carryover_enabled)));
  CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES account(id),filename TEXT NOT NULL,imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,parser_id TEXT NOT NULL DEFAULT 'generic',rows_new INTEGER NOT NULL,rows_skipped INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES account(id),booking_date TEXT NOT NULL,amount_cents INTEGER NOT NULL,counterparty TEXT NOT NULL,purpose TEXT NOT NULL,category_id INTEGER REFERENCES category(id),category_source TEXT CHECK(category_source IN ('rule','manual')),import_id INTEGER REFERENCES imports(id),dedup_hash TEXT NOT NULL,dedup_occurrence INTEGER NOT NULL,UNIQUE(dedup_hash,dedup_occurrence));
  CREATE INDEX IF NOT EXISTS tx_date ON transactions(booking_date,id);
  CREATE INDEX IF NOT EXISTS tx_account_date ON transactions(account_id,booking_date);
  CREATE INDEX IF NOT EXISTS tx_category_date ON transactions(category_id,booking_date);
  CREATE TABLE IF NOT EXISTS rule(id INTEGER PRIMARY KEY,match_text TEXT NOT NULL,match_field TEXT NOT NULL,category_id INTEGER NOT NULL REFERENCES category(id),priority INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS budget(id INTEGER PRIMARY KEY,month TEXT NOT NULL,category_id INTEGER NOT NULL REFERENCES category(id),amount_cents INTEGER NOT NULL,UNIQUE(month,category_id));
  CREATE TABLE IF NOT EXISTS import_profile(id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL UNIQUE REFERENCES account(id) ON DELETE CASCADE,name TEXT NOT NULL DEFAULT 'Generic',config TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS recurring_item(id INTEGER PRIMARY KEY,name TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),interval TEXT NOT NULL,first_due_date TEXT NOT NULL,category_id INTEGER NOT NULL REFERENCES category(id),counterparty_hint TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS recurring_occurrence(id INTEGER PRIMARY KEY,recurring_item_id INTEGER NOT NULL REFERENCES recurring_item(id) ON DELETE CASCADE,due_date TEXT NOT NULL,amount_cents INTEGER NOT NULL,category_id INTEGER NOT NULL REFERENCES category(id),matched_transaction_id INTEGER UNIQUE REFERENCES transactions(id),previous_category_id INTEGER REFERENCES category(id),previous_category_source TEXT CHECK(previous_category_source IN ('rule','manual')),UNIQUE(recurring_item_id,due_date));
  CREATE TABLE IF NOT EXISTS transfer_pair(id INTEGER PRIMARY KEY,outgoing_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),incoming_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),outgoing_previous_category_id INTEGER REFERENCES category(id),outgoing_previous_category_source TEXT CHECK(outgoing_previous_category_source IN ('rule','manual')),incoming_previous_category_id INTEGER REFERENCES category(id),incoming_previous_category_source TEXT CHECK(incoming_previous_category_source IN ('rule','manual')));
  CREATE TABLE IF NOT EXISTS setup_progress(id INTEGER PRIMARY KEY CHECK(id=1),step INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS setup_action(key TEXT PRIMARY KEY);
  INSERT OR IGNORE INTO setup_progress(id) VALUES(1);
  INSERT OR IGNORE INTO migration VALUES(1);`);
  atomic(db, () => {
    if (db.prepare("SELECT version FROM migration WHERE version=2").get())
      return;
    const occurrenceColumns = new Set(
      db
        .prepare("PRAGMA table_info(recurring_occurrence)")
        .all()
        .map((row) => row.name),
    );
    const pairColumns = new Set(
      db
        .prepare("PRAGMA table_info(transfer_pair)")
        .all()
        .map((row) => row.name),
    );
    const legacyOccurrences = !occurrenceColumns.has("previous_category_id");
    const legacyPairs = !pairColumns.has("outgoing_previous_category_id");
    for (const [table, columns, names] of [
      [
        "recurring_occurrence",
        occurrenceColumns,
        ["previous_category_id", "previous_category_source"],
      ],
      [
        "transfer_pair",
        pairColumns,
        [
          "outgoing_previous_category_id",
          "outgoing_previous_category_source",
          "incoming_previous_category_id",
          "incoming_previous_category_source",
        ],
      ],
    ] as const) {
      for (const name of names) {
        if (columns.has(name)) continue;
        db.exec(
          `ALTER TABLE ${table} ADD COLUMN ${name} ${name.endsWith("_id") ? "INTEGER REFERENCES category(id)" : "TEXT CHECK(" + name + " IN ('rule','manual'))"}`,
        );
      }
    }
    // Existing matches predate snapshots; their lost original category cannot be recovered.
    // Preserve their current assignment as the migration's explicit undo baseline.
    if (legacyOccurrences)
      db.exec(
        `UPDATE recurring_occurrence SET previous_category_id=(SELECT category_id FROM transactions WHERE id=matched_transaction_id),previous_category_source=(SELECT category_source FROM transactions WHERE id=matched_transaction_id) WHERE matched_transaction_id IS NOT NULL`,
      );
    if (legacyPairs)
      db.exec(
        `UPDATE transfer_pair SET outgoing_previous_category_id=(SELECT category_id FROM transactions WHERE id=outgoing_transaction_id),outgoing_previous_category_source=(SELECT category_source FROM transactions WHERE id=outgoing_transaction_id),incoming_previous_category_id=(SELECT category_id FROM transactions WHERE id=incoming_transaction_id),incoming_previous_category_source=(SELECT category_source FROM transactions WHERE id=incoming_transaction_id)`,
      );
    db.prepare("INSERT INTO migration(version) VALUES(2)").run();
  });
  if (
    !db
      .prepare("SELECT value FROM settings WHERE key='categories_seeded'")
      .get()
  ) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const names = [
        "Wohnen",
        "Lebensmittel",
        "Mobilität",
        "Versicherungen",
        "Abos und Medien",
        "Gesundheit",
        "Freizeit",
        "Kleidung",
        "Sonstiges",
        "Sparen",
        "Einkommen",
        "Umbuchung",
      ];
      names.forEach((name, i) =>
        db
          .prepare(
            "INSERT INTO category(name,sort_order,is_income,is_excluded) VALUES(?,?,?,?)",
          )
          .run(name, i, +(name === "Einkommen"), +(name === "Umbuchung")),
      );
      db.prepare("INSERT INTO settings VALUES('categories_seeded','1')").run();
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}
export function atomic<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = action();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
