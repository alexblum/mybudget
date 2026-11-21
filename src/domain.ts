export interface Category {
  id: number;
  name: string;
  sort_order: number;
  carryover_enabled: number;
  is_income: number;
  is_excluded: number;
}

export interface Transaction {
  id: number;
  account_id: number;
  booking_date: string;
  amount_cents: number;
  counterparty: string;
  purpose: string;
  category_id: number | null;
  category_source: string | null;
}

export interface Rule {
  id: number;
  match_text: string;
  match_field: string;
  category_id: number;
  priority: number;
}

export interface Budget {
  month: string;
  category_id: number;
  amount_cents: number;
}

type RuleTransaction = Pick<Transaction, "counterparty" | "purpose"> &
  Partial<Pick<Transaction, "category_id" | "category_source">>;

export function matchRule(
  transaction: RuleTransaction,
  rules: readonly Rule[],
): number | null {
  if (transaction.category_source === "manual")
    return transaction.category_id ?? null;
  const counterparty = transaction.counterparty.toUpperCase();
  const purpose = transaction.purpose.toUpperCase();
  let winner: Rule | undefined;
  for (const rule of rules) {
    if (!rule.match_text.trim()) continue;
    const needle = rule.match_text.toUpperCase();
    const matches =
      ((rule.match_field === "counterparty" || rule.match_field === "both") &&
        counterparty.includes(needle)) ||
      ((rule.match_field === "purpose" || rule.match_field === "both") &&
        purpose.includes(needle));
    if (
      matches &&
      (!winner ||
        rule.priority < winner.priority ||
        (rule.priority === winner.priority && rule.id < winner.id))
    )
      winner = rule;
  }
  return winner?.category_id ?? null;
}

function monthIndex(month: string): number {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000")) {
    throw new Error("Ungültiger Monat; erwartet wird JJJJ-MM.");
  }
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function isBudgetable(category: Category): boolean {
  return !category.is_income && !category.is_excluded;
}

export interface DashboardCategory extends Category {
  budget_cents: number;
  carryover_cents: number;
  expense_cents: number;
  remaining_cents: number;
}

export interface Dashboard {
  month: string;
  income_cents: number;
  planning_income_cents: number;
  income_source: "actual" | "previous_month";
  income_basis_missing: boolean;
  budget_cents: number;
  unplanned_cents: number;
  expense_cents: number;
  uncategorized_count: number;
  account_expense_cents: number | null;
  account_uncategorized_count: number | null;
  categories: DashboardCategory[];
}

export function dashboard(
  month: string,
  categories: readonly Category[],
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  accountId?: number,
): Dashboard {
  const target = monthIndex(month);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const categoryBudgets = new Map<number, Map<number, number>>();
  const categoryExpenses = new Map<number, Map<number, number>>();
  const firstMonths = new Map<number, number>();
  const recordStart = (id: number, index: number) => {
    const previous = firstMonths.get(id);
    if (previous === undefined || index < previous) firstMonths.set(id, index);
  };

  for (const budget of budgets) {
    const category = byId.get(budget.category_id);
    if (!category || !isBudgetable(category)) continue;
    const index = monthIndex(budget.month);
    if (index > target) continue;
    let months = categoryBudgets.get(category.id);
    if (!months) categoryBudgets.set(category.id, (months = new Map()));
    months.set(index, budget.amount_cents);
    recordStart(category.id, index);
  }

  let income = 0;
  let previousIncome = 0;
  let expense = 0;
  let uncategorized = 0;
  let accountExpense = 0;
  let accountUncategorized = 0;
  for (const transaction of transactions) {
    const index = monthIndex(transaction.booking_date.slice(0, 7));
    if (index > target) continue;
    const category =
      transaction.category_id === null
        ? undefined
        : byId.get(transaction.category_id);
    if (category?.is_income && transaction.amount_cents > 0) {
      if (index === target) income += transaction.amount_cents;
      else if (index === target - 1) previousIncome += transaction.amount_cents;
    }
    if (category && isBudgetable(category)) {
      recordStart(category.id, index);
      if (transaction.amount_cents < 0) {
        let months = categoryExpenses.get(category.id);
        if (!months) categoryExpenses.set(category.id, (months = new Map()));
        months.set(index, (months.get(index) ?? 0) - transaction.amount_cents);
      }
    }
    if (index !== target) continue;
    const selectedAccount = transaction.account_id === accountId;
    if (transaction.category_id === null) {
      uncategorized++;
      if (selectedAccount) accountUncategorized++;
    }
    if (
      transaction.amount_cents < 0 &&
      (transaction.category_id === null || (category && isBudgetable(category)))
    ) {
      expense -= transaction.amount_cents;
      if (selectedAccount) accountExpense -= transaction.amount_cents;
    }
  }

  const rows = categories
    .filter(isBudgetable)
    .map((category): DashboardCategory => {
      const first = firstMonths.get(category.id) ?? target;
      const amounts = categoryBudgets.get(category.id);
      const expenses = categoryExpenses.get(category.id);
      let budget = 0;
      let carryover = 0;
      let remaining = 0;
      for (let index = first; index <= target; index++) {
        budget = amounts?.get(index) ?? budget;
        carryover = category.carryover_enabled && index > first ? remaining : 0;
        remaining = budget + carryover - (expenses?.get(index) ?? 0);
      }
      return {
        ...category,
        budget_cents: budget,
        carryover_cents: carryover,
        expense_cents: expenses?.get(target) ?? 0,
        remaining_cents: remaining,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const budget = rows.reduce((sum, row) => sum + row.budget_cents, 0);
  const planningIncome = income > 0 ? income : previousIncome;
  return {
    month,
    income_cents: income,
    planning_income_cents: planningIncome,
    income_source: income > 0 ? "actual" : "previous_month",
    income_basis_missing: planningIncome === 0,
    budget_cents: budget,
    unplanned_cents: planningIncome - budget,
    expense_cents: expense,
    uncategorized_count: uncategorized,
    account_expense_cents: accountId === undefined ? null : accountExpense,
    account_uncategorized_count:
      accountId === undefined ? null : accountUncategorized,
    categories: rows,
  };
}

export function normalizeParty(text: string): string {
  return text.trim().replace(/\s+/gu, " ").toUpperCase();
}

export function normalizeHistoryParty(text: string): string {
  return normalizeParty(text)
    .replace(/\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b/gu, " ")
    .replace(/\b[0-9]{1,2}[./][0-9]{1,2}[./](?:[0-9]{4}|[0-9]{2})\b/gu, " ")
    .replace(/\b[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\b/gu, " ")
    .replace(
      /\b(?:FILIALE|FILIALNUMMER|FILIALNR\.?|FIL\.?|MARKTNR\.?|NR\.?)\s*[#:]?\s*[0-9]+(?:[-/][0-9]+)*\b/gu,
      " ",
    )
    .replace(/(^|\s)#?[0-9]{3,}(?=\s|$)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[\s;,|/]+$/u, "")
    .trim();
}

export const merchantCategoryHints: readonly {
  match_text: string;
  category_name: string;
}[] = [
  { match_text: "REWE", category_name: "Lebensmittel" },
  { match_text: "EDEKA", category_name: "Lebensmittel" },
  { match_text: "LIDL", category_name: "Lebensmittel" },
  { match_text: "ALDI", category_name: "Lebensmittel" },
  { match_text: "KAUFLAND", category_name: "Lebensmittel" },
  { match_text: "NETTO", category_name: "Lebensmittel" },
  { match_text: "PENNY", category_name: "Lebensmittel" },
  { match_text: "GLOBUS", category_name: "Lebensmittel" },
  { match_text: "DENNS", category_name: "Lebensmittel" },
  { match_text: "ALNATURA", category_name: "Lebensmittel" },
  { match_text: "DEUTSCHE BAHN", category_name: "Mobilität" },
  { match_text: "DB VERTRIEB", category_name: "Mobilität" },
  { match_text: "ARAL", category_name: "Mobilität" },
  { match_text: "SHELL", category_name: "Mobilität" },
  { match_text: "ESSO", category_name: "Mobilität" },
  { match_text: "JET TANK", category_name: "Mobilität" },
  { match_text: "ALLIANZ", category_name: "Versicherungen" },
  { match_text: "HUK", category_name: "Versicherungen" },
  { match_text: "AXA", category_name: "Versicherungen" },
  { match_text: "ERGO", category_name: "Versicherungen" },
  { match_text: "DEBEKA", category_name: "Versicherungen" },
  { match_text: "NETFLIX", category_name: "Abos und Medien" },
  { match_text: "SPOTIFY", category_name: "Abos und Medien" },
  { match_text: "DISNEY", category_name: "Abos und Medien" },
  { match_text: "RUNDFUNK", category_name: "Abos und Medien" },
  { match_text: "TELEKOM", category_name: "Abos und Medien" },
  { match_text: "VODAFONE", category_name: "Abos und Medien" },
  { match_text: "1&1", category_name: "Abos und Medien" },
  { match_text: "APOTHEKE", category_name: "Gesundheit" },
  { match_text: "DM-DROGERIE", category_name: "Gesundheit" },
  { match_text: "ROSSMANN", category_name: "Gesundheit" },
  { match_text: "DECATHLON", category_name: "Freizeit" },
  { match_text: "MCFIT", category_name: "Freizeit" },
  { match_text: "CINEMAXX", category_name: "Freizeit" },
  { match_text: "CINESTAR", category_name: "Freizeit" },
  { match_text: "ZALANDO", category_name: "Kleidung" },
  { match_text: "H&M", category_name: "Kleidung" },
  { match_text: "C&A", category_name: "Kleidung" },
  { match_text: "UNIQLO", category_name: "Kleidung" },
  { match_text: "VONOVIA", category_name: "Wohnen" },
  { match_text: "DEUTSCHE WOHNEN", category_name: "Wohnen" },
  { match_text: "STADTWERKE", category_name: "Wohnen" },
];

export function suggestCategory(
  party: string,
  categories: readonly Category[],
): number | null {
  const normalized = normalizeHistoryParty(party);
  for (const hint of merchantCategoryHints) {
    if (!normalized.includes(hint.match_text)) continue;
    const category = categories.find(
      (item) =>
        isBudgetable(item) &&
        normalizeParty(item.name) === normalizeParty(hint.category_name),
    );
    if (category) return category.id;
  }
  return null;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2)
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function recurringDates(
  firstDate: string,
  interval: string,
  throughMonth: string,
): string[] {
  const through = monthIndex(throughMonth);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(firstDate)) {
    throw new Error("Ungültiges Datum; erwartet wird JJJJ-MM-TT.");
  }
  const first = monthIndex(firstDate.slice(0, 7));
  const day = Number(firstDate.slice(8, 10));
  if (day < 1 || day > daysInMonth(Math.floor(first / 12), (first % 12) + 1)) {
    throw new Error("Ungültiges Datum für die erste Fälligkeit.");
  }
  let step: number;
  switch (interval) {
    case "monthly":
      step = 1;
      break;
    case "quarterly":
      step = 3;
      break;
    case "yearly":
      step = 12;
      break;
    default:
      throw new Error("Ungültiges Intervall.");
  }
  const dates: string[] = [];
  for (let index = first; index <= through; index += step) {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const dueDay = Math.min(day, daysInMonth(year, month));
    dates.push(
      `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`,
    );
  }
  return dates;
}

export interface IncomeSuggestion {
  key: string;
  counterparty: string;
  amount_cents: number;
  transaction_ids: number[];
}

export interface RecurringSuggestion extends IncomeSuggestion {
  first_due_date: string;
}

export interface HistorySuggestions {
  income: IncomeSuggestion[];
  recurring: RecurringSuggestion[];
}

function doubledMedian(values: readonly number[]): bigint {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return BigInt(sorted[middle]) + BigInt(sorted[(sorted.length - 1) >> 1]);
}

export function detectHistory(
  transactions: readonly Transaction[],
): HistorySuggestions {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const key = normalizeHistoryParty(transaction.counterparty);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(transaction);
    else groups.set(key, [transaction]);
  }
  const income: IncomeSuggestion[] = [];
  const recurring: RecurringSuggestion[] = [];
  const totals = new Map<string, bigint>();
  for (const [key, group] of groups) {
    totals.set(
      key,
      group.reduce((sum, row) => sum + BigInt(Math.abs(row.amount_cents)), 0n),
    );
    const positives = group.filter((row) => row.amount_cents >= 10000);
    if (
      new Set(positives.map((row) => row.booking_date.slice(0, 7))).size >= 2
    ) {
      income.push({
        key,
        counterparty: key,
        amount_cents: Number(
          (doubledMedian(positives.map((row) => row.amount_cents)) + 1n) / 2n,
        ),
        transaction_ids: positives.map((row) => row.id).sort((a, b) => a - b),
      });
    }
    const negatives = group.filter((row) => row.amount_cents < 0);
    if (new Set(negatives.map((row) => row.booking_date.slice(0, 7))).size < 2)
      continue;
    const median = doubledMedian(negatives.map((row) => -row.amount_cents));
    const stable = negatives.every((row) => {
      const difference = -2n * BigInt(row.amount_cents) - median;
      return (difference < 0n ? -difference : difference) * 20n <= median;
    });
    if (!stable) continue;
    recurring.push({
      key,
      counterparty: key,
      amount_cents: Number((median + 1n) / 2n),
      first_due_date: negatives.reduce(
        (latest, row) =>
          row.booking_date > latest ? row.booking_date : latest,
        negatives[0].booking_date,
      ),
      transaction_ids: negatives.map((row) => row.id).sort((a, b) => a - b),
    });
  }
  const compare = (a: IncomeSuggestion, b: IncomeSuggestion): number => {
    const aTotal = totals.get(a.key)!;
    const bTotal = totals.get(b.key)!;
    if (aTotal !== bTotal) return aTotal > bTotal ? -1 : 1;
    return (
      b.transaction_ids.length - a.transaction_ids.length ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    );
  };
  income.sort(compare);
  recurring.sort(compare);
  return { income, recurring };
}

export function startBudgets(
  fromMonth: string,
  toMonth: string,
  categories: readonly Category[],
  transactions: readonly Transaction[],
): { category_id: number; amount_cents: number }[] {
  const first = monthIndex(fromMonth);
  const last = monthIndex(toMonth);
  if (last < first)
    throw new Error(
      "Der Zeitraum muss mindestens einen vollständigen Monat enthalten.",
    );
  const monthCount = BigInt(last - first + 1);
  const totals = new Map<number, bigint>();
  const budgetable = categories
    .filter(isBudgetable)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  for (const category of budgetable) totals.set(category.id, 0n);
  for (const transaction of transactions) {
    if (
      transaction.category_id === null ||
      transaction.amount_cents >= 0 ||
      !totals.has(transaction.category_id)
    )
      continue;
    const month = transaction.booking_date.slice(0, 7);
    if (month < fromMonth || month > toMonth) continue;
    totals.set(
      transaction.category_id,
      totals.get(transaction.category_id)! - BigInt(transaction.amount_cents),
    );
  }
  return budgetable.map((category) => ({
    category_id: category.id,
    amount_cents: Number(
      (totals.get(category.id)! * 2n + monthCount) / (monthCount * 2n),
    ),
  }));
}
