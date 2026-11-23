import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { ParsedTransaction } from "./parser.js";

type Row = Record<string, SQLOutputValue>;
export interface PaypalDetail {
  id: number;
  booking_date: string;
  amount_cents: number;
  counterparty: string;
  purpose: string;
  external_id: string;
  related_external_id: string | null;
  paypal_kind: string;
  transaction_id: number | null;
  auto_suppressed: number;
}
interface Candidate {
  id: number;
  booking_date: string;
  amount_cents: number;
  counterparty: string;
  purpose: string;
}
export class PaypalError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}
const detail = (row: Row): PaypalDetail => ({
  id: Number(row.id),
  booking_date: String(row.booking_date),
  amount_cents: Number(row.amount_cents),
  counterparty: String(row.counterparty),
  purpose: String(row.purpose),
  external_id: String(row.external_id),
  related_external_id: row.related_external_id === null ? null : String(row.related_external_id),
  paypal_kind: String(row.paypal_kind),
  transaction_id: row.transaction_id === null ? null : Number(row.transaction_id),
  auto_suppressed: Number(row.auto_suppressed),
});
const isDetail = (row: PaypalDetail) => row.paypal_kind === "payment" || row.paypal_kind === "refund";
const withinWindow = (left: string, right: string) => Math.abs(Date.parse(left) - Date.parse(right)) <= 14 * 86400000;
const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const genericMerchantWords: Record<string, true> = { paypal: true, gmbh: true, limited: true, international: true, distribution: true, payment: true, payments: true, europe: true, sarl: true, co: true, ltd: true, inc: true, company: true, commerce: true, online: true, shop: true, store: true, services: true, service: true, group: true, handels: true, handel: true, deutschland: true };
function merchantEvidence(row: PaypalDetail, bank: Candidate): boolean {
  const bankText = normalized(`${bank.counterparty} ${bank.purpose}`);
  const bankWords = new Set(bankText.split(" "));
  const merchantWords = normalized(row.counterparty).split(" ").filter((word) => word.length >= 4 && !Object.hasOwn(genericMerchantWords, word));
  return merchantWords.some((word) => bankWords.has(word)) ||
    (merchantWords.length > 1 && bankText.replaceAll(" ", "").includes(merchantWords.join("")));
}
function references(movement: PaypalDetail, payment: PaypalDetail): boolean {
  return movement.related_external_id === payment.external_id || payment.related_external_id === movement.external_id ||
    (payment.paypal_kind === "refund" && payment.related_external_id !== null && movement.related_external_id === payment.related_external_id);
}

export function paypalStore(db: DatabaseSync) {
  const raw = () => db.prepare("SELECT * FROM paypal_detail ORDER BY booking_date DESC,id DESC").all().map(detail);
  function matchingData() {
    const rows = raw();
    const payments = rows.filter(isDetail);
    const byExternalId = new Map(rows.map((row) => [row.external_id, row]));
    const movements = rows.filter((row) => row.paypal_kind === "bank_funding" || row.paypal_kind === "bank_withdrawal");
    const credits = rows.filter((row) => row.paypal_kind === "credit_funding");
    const occupied = new Map(payments.filter((row) => row.transaction_id !== null).map((row) => [row.transaction_id!, row.id]));
    const banks: Candidate[] = db.prepare(`SELECT t.id,t.booking_date,t.amount_cents,t.counterparty,t.purpose FROM transactions t
      WHERE NOT EXISTS (SELECT 1 FROM transfer_pair p WHERE t.id=p.outgoing_transaction_id OR t.id=p.incoming_transaction_id)
      AND NOT EXISTS (SELECT 1 FROM recurring_occurrence o WHERE o.matched_transaction_id=t.id)
      AND lower(t.counterparty || ' ' || t.purpose) LIKE '%paypal%'`).all().map((row) => ({
      id: Number(row.id), booking_date: String(row.booking_date), amount_cents: Number(row.amount_cents), counterparty: String(row.counterparty), purpose: String(row.purpose),
    }));
    const candidates = new Map<number, Candidate[]>();
    const creditIds = new Set<number>();
    for (const payment of payments) {
      const original = payment.paypal_kind === "refund" && payment.related_external_id !== null ? byExternalId.get(payment.related_external_id) : undefined;
      if (credits.some((credit) => references(credit, payment) || (original !== undefined && references(credit, original)))) creditIds.add(payment.id);
      const financing = movements.filter((movement) =>
        movement.paypal_kind === (payment.paypal_kind === "payment" ? "bank_funding" : "bank_withdrawal") &&
        movement.amount_cents === -payment.amount_cents && references(movement, payment));
      let matches = creditIds.has(payment.id) ? [] : banks.filter((bank) =>
        (occupied.get(bank.id) === undefined || occupied.get(bank.id) === payment.id) &&
        bank.amount_cents === payment.amount_cents && bank.amount_cents !== 0 &&
        (payment.paypal_kind === "payment" ? bank.amount_cents < 0 : bank.amount_cents > 0) &&
        financing.some((movement) => withinWindow(bank.booking_date, movement.booking_date)));
      const merchantMatches = matches.filter((bank) => merchantEvidence(payment, bank));
      if (merchantMatches.length) matches = merchantMatches;
      candidates.set(payment.id, matches);
    }
    return { payments, candidates, creditIds };
  }
  function match() {
    // New files can introduce another candidate or reveal credit funding. Only manual decisions are final.
    db.prepare("UPDATE paypal_detail SET transaction_id=NULL,link_source=NULL WHERE link_source='auto'").run();
    const { payments, candidates } = matchingData();
    const claims = new Map<number, number>();
    for (const payment of payments) {
      if (payment.transaction_id !== null) continue;
      for (const bank of candidates.get(payment.id)!) claims.set(bank.id, (claims.get(bank.id) ?? 0) + 1);
    }
    const link = db.prepare("UPDATE paypal_detail SET transaction_id=?,link_source='auto' WHERE id=? AND transaction_id IS NULL AND auto_suppressed=0");
    for (const payment of payments) {
      if (payment.transaction_id !== null || payment.auto_suppressed) continue;
      const banks = candidates.get(payment.id)!;
      if (banks.length === 1 && claims.get(banks[0].id) === 1) link.run(banks[0].id, payment.id);
    }
  }
  function list() {
    const { payments, candidates, creditIds } = matchingData();
    const claims = new Map<number, number>();
    for (const payment of payments) if (payment.transaction_id === null)
      for (const bank of candidates.get(payment.id)!) claims.set(bank.id, (claims.get(bank.id) ?? 0) + 1);
    return payments.map((payment) => {
      const banks = candidates.get(payment.id)!;
      const { auto_suppressed, ...row } = payment;
      const status = payment.transaction_id !== null ? "linked" : auto_suppressed ? "unlinked" : creditIds.has(payment.id) ? "credit_unmatched" :
        banks.length > 1 || banks.some((bank) => (claims.get(bank.id) ?? 0) > 1) ? "ambiguous" : "unmatched";
      return { ...row, status, candidates: banks };
    });
  }
  return {
    match,
    list,
    linkedDetails(transactionIds: number[]) {
      const ids = new Set(transactionIds);
      const result = new Map<number, Omit<PaypalDetail, "auto_suppressed">[]>();
      for (const payment of raw()) {
        if (payment.transaction_id === null || !ids.has(payment.transaction_id) || !isDetail(payment)) continue;
        const { auto_suppressed: _suppressed, ...row } = payment;
        const entries = result.get(payment.transaction_id) ?? [];
        entries.push(row);
        result.set(payment.transaction_id, entries);
      }
      return result;
    },
    importRows(filename: string, rows: ParsedTransaction[]) {
      const importId = Number(db.prepare("INSERT INTO paypal_import(filename,rows_new,rows_skipped) VALUES(?,0,0)").run(filename).lastInsertRowid);
      let added = 0;
      for (const row of rows) {
        if (!row.external_id || !row.paypal_kind) throw new PaypalError("PayPal-Transaktionscode oder Buchungsart fehlt");
        const existing = db.prepare("SELECT * FROM paypal_detail WHERE external_id=?").get(row.external_id);
        if (existing) {
          if (existing.booking_date !== row.booking_date || existing.amount_cents !== row.amount_cents || existing.counterparty !== row.counterparty ||
            existing.purpose !== row.purpose || existing.related_external_id !== (row.related_external_id ?? null) || existing.paypal_kind !== row.paypal_kind)
            throw new PaypalError("PayPal-Transaktionscode mit abweichenden Buchungsdaten", 409);
          continue;
        }
        db.prepare("INSERT INTO paypal_detail(booking_date,amount_cents,counterparty,purpose,external_id,related_external_id,paypal_kind,import_id) VALUES(?,?,?,?,?,?,?,?)")
          .run(row.booking_date, row.amount_cents, row.counterparty, row.purpose, row.external_id, row.related_external_id ?? null, row.paypal_kind, importId);
        added++;
      }
      db.prepare("UPDATE paypal_import SET rows_new=?,rows_skipped=? WHERE id=?").run(added, rows.length - added, importId);
      match();
      const importedIds = new Set(rows.map((row) => row.external_id));
      const payments = raw().filter((row) => isDetail(row) && importedIds.has(row.external_id));
      return { new_count: added, skipped_count: rows.length - added, uncategorized_count: 0,
        linked_count: payments.filter((row) => row.transaction_id !== null).length,
        unmatched_count: payments.filter((row) => row.transaction_id === null).length };
    },
    link(detailId: number, transactionId: number) {
      const { payments, candidates } = matchingData();
      if (!payments.some((row) => row.id === detailId)) throw new PaypalError("PayPal-Detail nicht gefunden", 404);
      if (!candidates.get(detailId)!.some((bank) => bank.id === transactionId))
        throw new PaypalError("Buchung ist kein gültiger freier PayPal-Kandidat", 409);
      db.prepare("UPDATE paypal_detail SET transaction_id=?,link_source='manual',auto_suppressed=0 WHERE id=?").run(transactionId, detailId);
    },
    unlink(detailId: number) {
      const row = db.prepare("SELECT paypal_kind FROM paypal_detail WHERE id=?").get(detailId);
      if (!row || !["payment", "refund"].includes(String(row.paypal_kind))) throw new PaypalError("PayPal-Detail nicht gefunden", 404);
      db.prepare("UPDATE paypal_detail SET transaction_id=NULL,link_source=NULL,auto_suppressed=1 WHERE id=?").run(detailId);
    },
  };
}

export function migratePaypal(db: DatabaseSync) {
  db.exec(`CREATE TABLE paypal_import(id INTEGER PRIMARY KEY,filename TEXT NOT NULL,imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,rows_new INTEGER NOT NULL,rows_skipped INTEGER NOT NULL);
    CREATE TABLE paypal_detail(id INTEGER PRIMARY KEY,booking_date TEXT NOT NULL,amount_cents INTEGER NOT NULL,counterparty TEXT NOT NULL,purpose TEXT NOT NULL,external_id TEXT NOT NULL UNIQUE,related_external_id TEXT,paypal_kind TEXT NOT NULL CHECK(paypal_kind IN ('payment','refund','bank_funding','bank_withdrawal','credit_funding','credit_repayment')),import_id INTEGER REFERENCES paypal_import(id),transaction_id INTEGER UNIQUE REFERENCES transactions(id),link_source TEXT CHECK(link_source IN ('auto','manual')),auto_suppressed INTEGER NOT NULL DEFAULT 0 CHECK(auto_suppressed IN (0,1)),CHECK(transaction_id IS NULL OR paypal_kind IN ('payment','refund')),CHECK((transaction_id IS NULL)=(link_source IS NULL)));
    CREATE INDEX paypal_related ON paypal_detail(related_external_id);
    CREATE INDEX paypal_date ON paypal_detail(booking_date,id);`);
  const legacy = db.prepare("SELECT * FROM transactions WHERE paypal_kind IS NOT NULL ORDER BY id").all();
  const importIds = new Map<number, number>();
  for (const row of db.prepare("SELECT * FROM imports WHERE parser_id='paypal-de' OR id IN (SELECT import_id FROM transactions WHERE paypal_kind IS NOT NULL)").all()) {
    const result = db.prepare("INSERT INTO paypal_import(filename,imported_at,rows_new,rows_skipped) VALUES(?,?,?,?)").run(row.filename!, row.imported_at!, row.rows_new!, row.rows_skipped!);
    importIds.set(Number(row.id), Number(result.lastInsertRowid));
  }
  for (const row of legacy) {
    const externalId = row.external_id === null ? `legacy-transaction:${row.id}` : String(row.external_id);
    const previous = db.prepare("SELECT * FROM paypal_detail WHERE external_id=?").get(externalId);
    if (previous) {
      for (const key of ["booking_date", "amount_cents", "counterparty", "purpose", "related_external_id", "paypal_kind"])
        if (previous[key] !== row[key]) throw new Error(`Widersprüchliche alte PayPal-Buchungen: ${externalId}`);
      continue;
    }
    db.prepare("INSERT INTO paypal_detail(booking_date,amount_cents,counterparty,purpose,external_id,related_external_id,paypal_kind,import_id) VALUES(?,?,?,?,?,?,?,?)")
      .run(row.booking_date!, row.amount_cents!, row.counterparty!, row.purpose!, externalId, row.related_external_id!, row.paypal_kind!, importIds.get(Number(row.import_id)) ?? null);
  }
  const legacyById = new Map(legacy.map((row) => [Number(row.id), row]));
  const oldLinks: { external_id: string; transaction_id: number }[] = [];
  for (const pair of db.prepare("SELECT * FROM transfer_pair").all()) {
    const outgoing = Number(pair.outgoing_transaction_id), incoming = Number(pair.incoming_transaction_id);
    if (!legacyById.has(outgoing) && !legacyById.has(incoming)) continue;
    for (const [transactionId, prefix] of [[outgoing, "outgoing"], [incoming, "incoming"]] as const) {
      if (legacyById.has(transactionId)) continue;
      db.prepare("UPDATE transactions SET category_id=?,category_source=? WHERE id=?").run(pair[`${prefix}_previous_category_id`]!, pair[`${prefix}_previous_category_source`]!, transactionId);
      const movement = legacyById.get(transactionId === outgoing ? incoming : outgoing)!;
      if (movement.external_id !== null) oldLinks.push({ external_id: String(movement.external_id), transaction_id: transactionId });
    }
    db.prepare("DELETE FROM transfer_pair WHERE id=?").run(pair.id!);
  }
  db.exec(`UPDATE recurring_occurrence SET matched_transaction_id=NULL,previous_category_id=NULL,previous_category_source=NULL
    WHERE matched_transaction_id IN (SELECT id FROM transactions WHERE paypal_kind IS NOT NULL);
    DELETE FROM setup_action WHERE key IN (SELECT 'group-tx:' || id FROM transactions WHERE paypal_kind IS NOT NULL)
      OR key IN (SELECT 'income-tx:' || id FROM transactions WHERE paypal_kind IS NOT NULL);
    DELETE FROM transactions WHERE paypal_kind IS NOT NULL;
    DELETE FROM imports WHERE parser_id='paypal-de' AND NOT EXISTS (SELECT 1 FROM transactions WHERE transactions.import_id=imports.id);
    DROP INDEX tx_external;
    ALTER TABLE transactions DROP COLUMN external_id;
    ALTER TABLE transactions DROP COLUMN related_external_id;
    ALTER TABLE transactions DROP COLUMN paypal_kind;`);
  const store = paypalStore(db);
  for (const old of oldLinks) {
    const movementRow = db.prepare("SELECT * FROM paypal_detail WHERE external_id=?").get(old.external_id);
    if (!movementRow) continue;
    const movement = detail(movementRow);
    const compatible = store.list().filter((payment) => references(movement, { ...payment, auto_suppressed: 0 }) && payment.candidates.some((bank) => bank.id === old.transaction_id));
    if (compatible.length === 1) store.link(compatible[0].id, old.transaction_id);
  }
  store.match();
}
