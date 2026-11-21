import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboard,
  detectHistory,
  matchRule,
  normalizeHistoryParty,
  normalizeParty,
  recurringDates,
  suggestCategory,
  type Budget,
  startBudgets,
  type Category,
  type Rule,
  type Transaction,
} from "../src/domain.js";

const category = (id: number, overrides: Partial<Category> = {}): Category => ({
  id,
  name: `Kategorie ${id}`,
  sort_order: id,
  carryover_enabled: 0,
  is_income: 0,
  is_excluded: 0,
  ...overrides,
});
const transaction = (
  id: number,
  overrides: Partial<Transaction> = {},
): Transaction => ({
  id,
  account_id: 1,
  booking_date: "2026-01-15",
  amount_cents: -1000,
  counterparty: "Händler",
  purpose: "",
  category_id: 1,
  category_source: "rule",
  ...overrides,
});
const rule = (id: number, overrides: Partial<Rule> = {}): Rule => ({
  id,
  match_text: "rewe",
  match_field: "counterparty",
  category_id: id,
  priority: 10,
  ...overrides,
});

test("rules choose lowest priority then stable ID without mutating their order", () => {
  const rules = [
    rule(8),
    rule(4),
    rule(9, { priority: 1 }),
    rule(2, { priority: 1 }),
  ];
  assert.equal(
    matchRule({ counterparty: "REWE Markt", purpose: "" }, rules),
    2,
  );
  assert.deepEqual(
    rules.map(({ id }) => id),
    [8, 4, 9, 2],
  );
  assert.equal(
    matchRule({ counterparty: "Andere Firma", purpose: "" }, rules),
    null,
  );
});

test("both rule fields are checked separately and manual categories are preserved", () => {
  const rules = [rule(1, { match_text: "one two", match_field: "both" })];
  assert.equal(matchRule({ counterparty: "one", purpose: "two" }, rules), null);
  assert.equal(
    matchRule({ counterparty: "", purpose: "ONE TWO Rechnung" }, rules),
    1,
  );
  assert.equal(
    matchRule(
      transaction(1, {
        counterparty: "one two",
        category_id: 77,
        category_source: "manual",
      }),
      rules,
    ),
    77,
  );
  assert.equal(
    matchRule(
      transaction(2, {
        counterparty: "one two",
        category_id: null,
        category_source: "manual",
      }),
      rules,
    ),
    null,
  );
  assert.equal(
    matchRule({ counterparty: "any", purpose: "text" }, [
      rule(2, { match_text: "  " }),
    ]),
    null,
  );
});

test("dashboard counts only negative budgetable spending and positive flagged income", () => {
  const categories = [
    category(1, { name: "Einkommen" }),
    category(2, { name: "Lohn", is_income: 1 }),
    category(3, { name: "Transfer", is_excluded: 1 }),
  ];
  const transactions = [
    transaction(1, { amount_cents: -4000 }),
    transaction(2, { amount_cents: 1500 }),
    transaction(3, { amount_cents: 200000, category_id: 2 }),
    transaction(4, { amount_cents: -10000, category_id: 2 }),
    transaction(5, { amount_cents: 0, category_id: 2 }),
    transaction(6, { amount_cents: -50000, category_id: 3 }),
    transaction(7, { amount_cents: 50000, category_id: 3 }),
    transaction(8, { amount_cents: -700, category_id: null }),
    transaction(9, { amount_cents: 100, category_id: null }),
  ];
  const result = dashboard("2026-01", categories, transactions, [
    { month: "2026-01", category_id: 1, amount_cents: 10000 },
  ]);
  assert.equal(result.income_cents, 200000);
  assert.equal(result.planning_income_cents, 200000);
  assert.equal(result.income_source, "actual");
  assert.equal(result.income_basis_missing, false);
  assert.equal(result.expense_cents, 4700);
  assert.equal(result.budget_cents, 10000);
  assert.equal(result.unplanned_cents, 190000);
  assert.equal(result.uncategorized_count, 2);
  assert.equal(result.account_expense_cents, null);
  assert.equal(result.account_uncategorized_count, null);
  assert.deepEqual(
    result.categories.map(({ id }) => id),
    [1],
  );
  assert.equal(result.categories[0].expense_cents, 4000);
  assert.equal(result.categories[0].remaining_cents, 6000);
});

test("income assumptions use only the immediate previous actual month across year boundaries", () => {
  const categories = [category(1), category(2, { is_income: 1 })];
  const transactions = [
    transaction(1, {
      booking_date: "2025-12-30",
      category_id: 2,
      amount_cents: 250000,
    }),
    transaction(2, {
      booking_date: "2026-01-10",
      category_id: 2,
      amount_cents: -5000,
    }),
    transaction(3, {
      booking_date: "2026-01-11",
      category_id: 2,
      amount_cents: 0,
    }),
  ];
  const january = dashboard("2026-01", categories, transactions, []);
  assert.equal(january.income_cents, 0);
  assert.equal(january.planning_income_cents, 250000);
  assert.equal(january.income_source, "previous_month");
  assert.equal(january.income_basis_missing, false);
  const february = dashboard("2026-02", categories, transactions, []);
  assert.equal(february.planning_income_cents, 0);
  assert.equal(february.income_basis_missing, true);
  const noHistory = dashboard("2025-11", categories, transactions, []);
  assert.equal(noHistory.planning_income_cents, 0);
  assert.equal(noHistory.income_basis_missing, true);
  transactions.push(transaction(4, { category_id: 2, amount_cents: 100 }));
  assert.equal(
    dashboard("2026-01", categories, transactions, []).planning_income_cents,
    100,
  );
  assert.equal(
    dashboard("2025-12", categories, transactions, []).planning_income_cents,
    250000,
  );
});

test("account filter adds account figures without changing global budgeting or income", () => {
  const categories = [
    category(1, { carryover_enabled: 1 }),
    category(2, { is_income: 1 }),
  ];
  const transactions = [
    transaction(1, { account_id: 1, amount_cents: -1000 }),
    transaction(2, { account_id: 2, amount_cents: -2000 }),
    transaction(3, { account_id: 2, amount_cents: -300, category_id: null }),
    transaction(4, { account_id: 2, amount_cents: 100000, category_id: 2 }),
  ];
  const budgets = [{ month: "2025-12", category_id: 1, amount_cents: 10000 }];
  const global = dashboard("2026-01", categories, transactions, budgets);
  const filtered = dashboard("2026-01", categories, transactions, budgets, 2);
  assert.equal(filtered.account_expense_cents, 2300);
  assert.equal(filtered.account_uncategorized_count, 1);
  assert.equal(filtered.expense_cents, 3300);
  assert.equal(filtered.planning_income_cents, 100000);
  assert.deepEqual(filtered.categories, global.categories);
  assert.equal(filtered.budget_cents, global.budget_cents);
  assert.equal(filtered.unplanned_cents, global.unplanned_cents);
});

test("carryover follows every calendar month, inherited budgets and explicit zero budgets", () => {
  const categories = [category(1, { carryover_enabled: 1 })];
  const budgets: Budget[] = [
    { month: "2025-11", category_id: 1, amount_cents: 10000 },
    { month: "2026-01", category_id: 1, amount_cents: 0 },
  ];
  const transactions = [
    transaction(1, { booking_date: "2025-11-10", amount_cents: -12000 }),
    transaction(2, { booking_date: "2025-12-10", amount_cents: -1000 }),
  ];
  const december = dashboard("2025-12", categories, transactions, budgets)
    .categories[0];
  assert.equal(december.budget_cents, 10000);
  assert.equal(december.carryover_cents, -2000);
  assert.equal(december.remaining_cents, 7000);
  const february = dashboard("2026-02", categories, transactions, budgets)
    .categories[0];
  assert.equal(february.budget_cents, 0);
  assert.equal(february.carryover_cents, 7000);
  assert.equal(february.remaining_cents, 7000);
  assert.deepEqual(
    budgets.map(({ amount_cents }) => amount_cents),
    [10000, 0],
  );
});

test("backdated spending and the current carryover flag recalculate the entire chain", () => {
  const categories = [category(1, { carryover_enabled: 1 })];
  const budgets = [{ month: "2025-12", category_id: 1, amount_cents: 10000 }];
  const transactions = [
    transaction(1, { booking_date: "2025-11-30", amount_cents: -3000 }),
  ];
  const january = dashboard("2026-01", categories, transactions, budgets)
    .categories[0];
  assert.equal(january.carryover_cents, 7000);
  assert.equal(january.remaining_cents, 17000);
  transactions.push(
    transaction(2, { booking_date: "2025-12-01", amount_cents: -5000 }),
  );
  assert.equal(
    dashboard("2026-01", categories, transactions, budgets).categories[0]
      .remaining_cents,
    12000,
  );
  categories[0].carryover_enabled = 0;
  const disabled = dashboard("2026-01", categories, transactions, budgets)
    .categories[0];
  assert.equal(disabled.carryover_cents, 0);
  assert.equal(disabled.remaining_cents, 10000);
});

test("budgetable categories sort deterministically and future history cannot affect earlier months", () => {
  const categories = [
    category(9, { sort_order: 1 }),
    category(1, { sort_order: 1 }),
    category(2),
  ];
  const result = dashboard(
    "2026-01",
    categories,
    [transaction(1, { booking_date: "2026-02-01", amount_cents: -5000 })],
    [{ month: "2026-02", category_id: 1, amount_cents: 9000 }],
  );
  assert.deepEqual(
    result.categories.map(({ id }) => id),
    [1, 9, 2],
  );
  assert.equal(result.budget_cents, 0);
  assert.equal(result.expense_cents, 0);
  assert.equal(result.categories[0].remaining_cents, 0);
});

test("monthly recurrence clamps month end without moving later due days", () => {
  assert.deepEqual(recurringDates("2025-12-31", "monthly", "2026-04"), [
    "2025-12-31",
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ]);
  assert.deepEqual(recurringDates("2024-01-31", "monthly", "2024-03"), [
    "2024-01-31",
    "2024-02-29",
    "2024-03-31",
  ]);
  assert.deepEqual(recurringDates("2026-06-15", "monthly", "2026-05"), []);
});

test("quarterly and yearly recurrences remain anchored to the original full date", () => {
  assert.deepEqual(recurringDates("2025-11-30", "quarterly", "2026-11"), [
    "2025-11-30",
    "2026-02-28",
    "2026-05-30",
    "2026-08-30",
    "2026-11-30",
  ]);
  assert.deepEqual(recurringDates("2024-02-29", "yearly", "2028-02"), [
    "2024-02-29",
    "2025-02-28",
    "2026-02-28",
    "2027-02-28",
    "2028-02-29",
  ]);
});

test("calendar APIs reject malformed months, impossible dates and unsupported intervals", () => {
  assert.throws(
    () => recurringDates("2026-02-29", "monthly", "2026-12"),
    /Datum/,
  );
  assert.throws(
    () => recurringDates("2026-01-01", "weekly", "2026-12"),
    /Intervall/,
  );
  assert.throws(
    () => recurringDates("2026-01-01", "monthly", "2026-13"),
    /Monat/,
  );
  assert.throws(() => dashboard("2026-1", [], [], []), /Monat/);
});

test("payment normalization only uppercases and normalizes whitespace", () => {
  assert.equal(normalizeParty("  Muster\t GmbH \n  123  "), "MUSTER GMBH 123");
  assert.equal(
    normalizeParty("REWE Filiale 1234 21.11.2026"),
    "REWE FILIALE 1234 21.11.2026",
  );
  assert.equal(normalizeParty("  "), "");
  assert.equal(normalizeParty("straße"), "STRASSE");
});

test("history groups strip branch and date residues without merging unrelated numeric names", () => {
  assert.equal(
    normalizeHistoryParty("  Rewe  Filiale 1234 21.11.2026  "),
    "REWE",
  );
  assert.equal(
    normalizeHistoryParty("REWE MARKT 4321 2026-10-21"),
    "REWE MARKT",
  );
  assert.equal(
    normalizeHistoryParty("LIDL Dienstleistung 1234 21/11/2026"),
    "LIDL DIENSTLEISTUNG",
  );
  assert.equal(normalizeHistoryParty("Studio 54"), "STUDIO 54");
  assert.equal(normalizeHistoryParty("1&1 Telecom GmbH"), "1&1 TELECOM GMBH");
  assert.equal(normalizeHistoryParty("Muster GmbH"), "MUSTER GMBH");
  assert.equal(normalizeHistoryParty(""), "");
});

test("merchant category hints use local defaults and never propose income or excluded categories", () => {
  const categories = [
    category(1, { name: "Lebensmittel" }),
    category(2, { name: "Mobilität" }),
  ];
  assert.equal(suggestCategory("REWE Filiale 1234", categories), 1);
  assert.equal(suggestCategory("Deutsche Bahn Vertrieb GmbH", categories), 2);
  assert.equal(suggestCategory("Unbekannter Händler", categories), null);
  assert.equal(
    suggestCategory("REWE", [
      category(1, { name: "Lebensmittel", is_income: 1 }),
    ]),
    null,
  );
  assert.equal(
    suggestCategory("REWE", [
      category(1, { name: "Lebensmittel", is_excluded: 1 }),
    ]),
    null,
  );
});

test("history income requires qualifying positive entries in distinct calendar months", () => {
  const result = detectHistory([
    transaction(1, {
      booking_date: "2025-12-30",
      counterparty: "  Arbeitgeber GmbH ",
      amount_cents: 10000,
    }),
    transaction(2, {
      booking_date: "2026-01-02",
      counterparty: "ARBEITGEBER GMBH",
      amount_cents: 10001,
    }),
    transaction(3, {
      booking_date: "2026-01-03",
      counterparty: "Arbeitgeber GmbH",
      amount_cents: 9999,
    }),
    transaction(4, { counterparty: "Nur ein Monat", amount_cents: 500000 }),
    transaction(5, { counterparty: "Nur ein Monat", amount_cents: 500000 }),
    transaction(6, {
      booking_date: "2025-12-01",
      counterparty: "Zu klein",
      amount_cents: 9999,
    }),
    transaction(7, { counterparty: "Zu klein", amount_cents: 10000 }),
  ]);
  assert.deepEqual(result.income, [
    {
      key: "ARBEITGEBER GMBH",
      counterparty: "ARBEITGEBER GMBH",
      amount_cents: 10001,
      transaction_ids: [1, 2],
    },
  ]);
});

test("monthly cost suggestions use the median and latest date with inclusive five-percent tolerance", () => {
  const transactions = [
    transaction(1, {
      booking_date: "2025-12-31",
      counterparty: "Strom Filiale 123",
      amount_cents: -950,
    }),
    transaction(2, {
      booking_date: "2026-01-02",
      counterparty: "Strom Filiale 456",
      amount_cents: -1000,
    }),
    transaction(3, {
      booking_date: "2026-02-04",
      counterparty: "Strom Filiale 789",
      amount_cents: -1050,
    }),
    transaction(4, {
      booking_date: "2025-12-01",
      counterparty: "Gerundet",
      amount_cents: -1000,
    }),
    transaction(5, {
      booking_date: "2026-01-01",
      counterparty: "Gerundet",
      amount_cents: -1001,
    }),
    transaction(6, {
      booking_date: "2025-12-01",
      counterparty: "Zu variabel",
      amount_cents: -949,
    }),
    transaction(7, {
      booking_date: "2026-01-01",
      counterparty: "Zu variabel",
      amount_cents: -1000,
    }),
    transaction(8, {
      booking_date: "2026-02-01",
      counterparty: "Zu variabel",
      amount_cents: -1050,
    }),
    transaction(9, { counterparty: "Ein Monat", amount_cents: -1000 }),
    transaction(10, { counterparty: "Ein Monat", amount_cents: -1000 }),
  ];
  const result = detectHistory(transactions);
  assert.deepEqual(result.recurring, [
    {
      key: "STROM",
      counterparty: "STROM",
      amount_cents: 1000,
      first_due_date: "2026-02-04",
      transaction_ids: [1, 2, 3],
    },
    {
      key: "GERUNDET",
      counterparty: "GERUNDET",
      amount_cents: 1001,
      first_due_date: "2026-01-01",
      transaction_ids: [4, 5],
    },
  ]);
  assert.deepEqual(detectHistory([...transactions].reverse()), result);
});

test("recurring tolerance is measured against the unrounded median and all negative amounts", () => {
  const result = detectHistory([
    transaction(1, {
      counterparty: "Grenze",
      booking_date: "2025-12-01",
      amount_cents: -950,
    }),
    transaction(2, {
      counterparty: "Grenze",
      booking_date: "2026-01-01",
      amount_cents: -1051,
    }),
    transaction(3, {
      counterparty: "Ausreisser",
      booking_date: "2025-12-01",
      amount_cents: -1000,
    }),
    transaction(4, {
      counterparty: "Ausreisser",
      booking_date: "2026-01-01",
      amount_cents: -1000,
    }),
    transaction(5, {
      counterparty: "Ausreisser",
      booking_date: "2026-02-01",
      amount_cents: -10000,
    }),
    transaction(6, {
      counterparty: "",
      booking_date: "2025-12-01",
      amount_cents: -1000,
    }),
    transaction(7, {
      counterparty: "  ",
      booking_date: "2026-01-01",
      amount_cents: -1000,
    }),
  ]);
  assert.deepEqual(result.recurring, []);
});

test("start budget averages every complete selected month including zero-spend months", () => {
  const categories = [
    category(1),
    category(2),
    category(3, { is_income: 1 }),
    category(4, { is_excluded: 1 }),
  ];
  const transactions = [
    transaction(1, { booking_date: "2025-12-01", amount_cents: -1000 }),
    transaction(2, { booking_date: "2026-01-31", amount_cents: -1001 }),
    transaction(3, { booking_date: "2026-01-31", amount_cents: 1000 }),
    transaction(4, {
      booking_date: "2026-01-31",
      amount_cents: -999999,
      category_id: 3,
    }),
    transaction(5, {
      booking_date: "2026-01-31",
      amount_cents: -999999,
      category_id: 4,
    }),
    transaction(6, {
      booking_date: "2026-01-31",
      amount_cents: -999999,
      category_id: null,
    }),
    transaction(7, { booking_date: "2025-11-30", amount_cents: -90000 }),
    transaction(8, { booking_date: "2026-03-01", amount_cents: -90000 }),
  ];
  assert.deepEqual(
    startBudgets("2025-12", "2026-02", categories, transactions),
    [
      { category_id: 1, amount_cents: 667 },
      { category_id: 2, amount_cents: 0 },
    ],
  );
  assert.deepEqual(
    startBudgets("2025-12", "2026-01", categories, transactions),
    [
      { category_id: 1, amount_cents: 1001 },
      { category_id: 2, amount_cents: 0 },
    ],
  );
});

test("start budget accepts only a nonempty interval of whole calendar months", () => {
  assert.throws(() => startBudgets("2026-01-15", "2026-03", [], []), /Monat/);
  assert.throws(() => startBudgets("2026-03", "2026-01", [], []), /Zeitraum/);
});

test("rule field selection and priority are independent of matching text length", () => {
  const transaction = {
    counterparty: "REWE Supermarkt",
    purpose: "Fahrkarte Bahn",
  };
  assert.equal(matchRule(transaction, [rule(1, { match_text: "bahn" })]), null);
  assert.equal(
    matchRule(transaction, [
      rule(1, { match_text: "rewe", match_field: "purpose" }),
    ]),
    null,
  );
  assert.equal(
    matchRule(transaction, [
      rule(3, { match_text: "supermarkt", priority: 5 }),
      rule(2, { match_text: "bahn", match_field: "purpose", priority: 1 }),
    ]),
    2,
  );
});

test("history normalization removes branch codes before location names", () => {
  assert.equal(
    normalizeHistoryParty("REWE 1234 Berlin 20.11.2026 18:42"),
    "REWE BERLIN",
  );
  assert.equal(
    normalizeHistoryParty("rewe 5678 berlin 21.11.2026 09:15"),
    "REWE BERLIN",
  );
  assert.equal(
    normalizeHistoryParty("Telekom Deutschland GmbH"),
    "TELEKOM DEUTSCHLAND GMBH",
  );
});
