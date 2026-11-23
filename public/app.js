import {
  h,
  icon,
  action,
  input,
  select,
  field,
  form,
  checkbox,
  modal,
  heading,
  empty,
  notify,
  money,
  date,
  currentMonth,
  monthName,
  categoryName,
  accountName,
} from "./ui.js";
import { accounts, categories, rules, ruleEditor } from "./manage.js";
import { importPage } from "./import.js";
import { budget, recurring, transfers } from "./planning.js";
import { setup } from "./setup.js";

const root = document.querySelector("#app");
let csrf = "";
let auth;
let renderVersion = 0;
const ctx = {
  state: {
    accounts: [],
    categories: [],
    rules: [],
    recurring_items: [],
    profiles: [],
    setup: { step: 0, complete: false },
  },
  month: currentMonth(),
  account: "",
  async api(path, method = "GET", payload) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(payload === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(method === "GET" ? {} : { "X-CSRF-Token": csrf }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith("/api/auth")) {
        auth = await ctx.api("/api/auth");
        csrf = auth.csrf;
        renderAuth("Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
      }
      throw new Error(
        data.error || "Die Anfrage konnte nicht abgeschlossen werden.",
      );
    }
    return data;
  },
  async refresh() {
    ctx.state = await ctx.api("/api/state");
  },
  navigate(page) {
    if (location.hash === `#${page}`) return ctx.render();
    location.hash = page;
  },
  monthToolbar(withAccount = true) {
    const change = async (delta) => {
      const d = new Date(`${ctx.month}-15T12:00:00`);
      d.setMonth(d.getMonth() + delta);
      ctx.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      await ctx.render();
    };
    const month = h(
      "div",
      { class: "month-picker" },
      action("Vorheriger Monat", () => change(-1), {
        class: "icon-button",
        icon: "left",
        iconOnly: true,
        "aria-label": "Vorheriger Monat",
      }),
      h("strong", { "aria-live": "polite" }, monthName(ctx.month)),
      action("Nächster Monat", () => change(1), {
        class: "icon-button",
        icon: "right",
        iconOnly: true,
        "aria-label": "Nächster Monat",
      }),
    );
    const account = select(
      [
        { value: "", label: "Alle Konten" },
        ...ctx.state.accounts.map((item) => ({
          value: item.id,
          label: item.name,
        })),
      ],
      ctx.account,
      { "aria-label": "Konto filtern" },
    );
    account.addEventListener("change", () => {
      ctx.account = account.value;
      ctx.render();
    });
    return h(
      "div",
      { class: "toolbar" },
      month,
      withAccount ? h("div", { class: "account-filter" }, account) : null,
    );
  },
  async render() {
    if (!auth?.authenticated) return;
    const version = ++renderVersion;
    const page = location.hash.slice(1) || "dashboard";
    const main = document.querySelector("#content");
    if (!main) return;
    const routes = {
      dashboard,
      transactions,
      budget,
      import: importPage,
      more,
      accounts,
      categories,
      rules,
      recurring,
      transfers,
      setup,
    };
    document.querySelectorAll(".nav-button").forEach((button) => {
      const active =
        button.dataset.route === page ||
        (button.dataset.route === "more" &&
          [
            "more",
            "accounts",
            "categories",
            "rules",
            "recurring",
            "transfers",
            "setup",
          ].includes(page));
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    main.setAttribute("aria-busy", "true");
    try {
      const content = await (routes[page] || dashboard)(ctx);
      if (version !== renderVersion) return;
      main.replaceChildren(
        content,
        h(
          "div",
          { class: "local-footer" },
          icon("shield"),
          "Deine Finanzen bleiben bei dir.",
        ),
      );
      document.title = `${{ dashboard: "Überblick", transactions: "Buchungen", budget: "Budget", import: "CSV-Import", more: "Mehr", setup: "Einrichtung", accounts: "Konten", categories: "Kategorien", rules: "Regeln", recurring: "Feste Posten", transfers: "Umbuchungen" }[page] || "Überblick"} · Mein Budget`;
    } catch (error) {
      if (!auth?.authenticated || version !== renderVersion) return;
      main.replaceChildren(
        h(
          "div",
          { class: "error-page", role: "alert" },
          h("h2", {}, "Das hat nicht geklappt."),
          h("p", {}, error.message),
          action("Erneut versuchen", () => ctx.render(), { class: "outline" }),
        ),
      );
    } finally {
      main.removeAttribute("aria-busy");
    }
  },
};
function brand() {
  return h(
    "div",
    { class: "brand" },
    h("span", { class: "brand-mark", "aria-hidden": true }, "m."),
    h("span", {}, "mein budget", h("small", {}, "Ein guter Überblick.")),
  );
}
function shell() {
  root.replaceChildren(
    h(
      "header",
      { class: "app-header" },
      brand(),
      h(
        "span",
        { class: "header-private" },
        h("span", { class: "status-dot" }),
        icon("shield"),
        "Lokal & privat",
      ),
    ),
    h("main", { id: "content", class: "main-content", tabindex: "-1" }),
    h(
      "nav",
      { class: "bottom-nav", "aria-label": "Hauptnavigation" },
      [
        ["dashboard", "Überblick", "grid"],
        ["transactions", "Buchungen", "list"],
        ["budget", "Budget", "wallet"],
        ["import", "Import", "upload"],
        ["more", "Mehr", "more"],
      ].map(([route, title, glyph]) =>
        action(title, () => ctx.navigate(route), {
          class: "nav-button",
          "data-route": route,
          icon: glyph,
        }),
      ),
    ),
  );
}
function renderAuth(message) {
  const initialize = !auth.initialized;
  const password = input("", {
    type: "password",
    autocomplete: initialize ? "new-password" : "current-password",
    required: true,
    minlength: initialize ? 10 : 1,
  });
  const repeat = input("", {
    type: "password",
    autocomplete: "new-password",
    required: initialize,
    minlength: 10,
  });
  root.replaceChildren(
    h(
      "main",
      { id: "content", class: "auth-layout" },
      brand(),
      h("p", { class: "eyebrow" }, "Weniger Kopfzerbrechen. Mehr Klarheit."),
      h(
        "h1",
        {},
        initialize ? "Dein Geld.\nDein guter Plan." : "Schön, dass du da bist.",
      ),
      h(
        "p",
        { class: "subtitle" },
        initialize
          ? "Willkommen in deinem persönlichen Finanzüberblick. Sichere zuerst deine privaten Daten mit einem Passwort."
          : "Melde dich an und bring Klarheit in deinen Monat.",
      ),
      message ? h("div", { class: "notice" }, message) : null,
      h(
        "div",
        { class: "auth-card" },
        form(
          async () => {
            if (initialize && password.value !== repeat.value)
              throw new Error("Die beiden Passwörter stimmen nicht überein.");
            const result = await ctx.api(
              `/api/auth/${initialize ? "setup" : "login"}`,
              "POST",
              { password: password.value },
            );
            auth = result.authenticated ? result : await ctx.api("/api/auth");
            csrf = auth.csrf || csrf;
            await start();
          },
          h(
            "div",
            { class: "form-grid" },
            field(
              "Passwort",
              password,
              initialize
                ? "Mindestens 10 Zeichen. Verwende ein eigenes, langes Passwort."
                : undefined,
            ),
            initialize ? field("Passwort wiederholen", repeat) : null,
          ),
          h(
            "button",
            { type: "submit", class: "primary" },
            initialize ? "Passwort festlegen" : "Anmelden",
          ),
        ),
      ),
      h(
        "div",
        { class: "auth-privacy" },
        icon("shield"),
        h(
          "span",
          {},
          "Vollständig lokal. Keine Cloud, keine Werbung, keine externen Dienste. Nur du und dein Budget.",
        ),
      ),
    ),
  );
}
async function start() {
  await ctx.refresh();
  shell();
  if (!location.hash) {
    history.replaceState(
      null,
      "",
      ctx.state.setup.complete ? "#dashboard" : "#setup",
    );
  }
  await ctx.render();
}
async function dashboard() {
  const data = await ctx.api(
    `/api/dashboard?month=${ctx.month}${ctx.account ? `&account_id=${ctx.account}` : ""}`,
  );
  const hero = h(
    "section",
    { class: "summary-hero", "aria-label": "Monatsübersicht" },
    h(
      "div",
      { class: "summary-top" },
      h(
        "div",
        {},
        h("p", { class: "eyebrow" }, "Noch nicht verplant"),
        h("div", { class: "hero-amount" }, money(data.unplanned_cents)),
        h(
          "p",
          { class: "hero-hint" },
          data.unplanned_cents < 0
            ? "Dein Plan liegt über deiner Einkommensbasis."
            : data.unplanned_cents === 0
              ? "Jeder Euro hat seinen Platz. Gut geplant."
              : "Gib deinem Geld eine Aufgabe.",
        ),
      ),
      h("span", { class: "hero-badge" }, "DEIN MONAT"),
    ),
    h("div", { class: "summary-line" }),
    h(
      "div",
      { class: "summary-grid" },
      h(
        "div",
        {},
        h("span", {}, "Einkommen · Planungsbasis"),
        h("strong", {}, money(data.planning_income_cents)),
        h(
          "p",
          { class: "hero-hint", style: "margin-top:5px" },
          data.income_source === "actual"
            ? "tatsächlich"
            : `Vormonat (Annahme)${data.income_basis_missing ? " · keine Basis vorhanden" : ""}`,
        ),
      ),
      h(
        "div",
        {},
        h("span", {}, "Ausgegeben · alle Konten"),
        h("strong", {}, money(data.expense_cents)),
        h(
          "p",
          { class: "hero-hint", style: "margin-top:5px" },
          "Dein aktueller Monatsstand",
        ),
      ),
    ),
  );
  const content = h(
    "div",
    {},
    heading(
      "Dein Monat. Dein Plan.",
      "Ein bisschen Überblick. Ein gutes Gefühl.",
      "Dein Finanzüberblick",
    ),
    ctx.monthToolbar(),
    hero,
    h(
      "div",
      { class: "stats-row" },
      h(
        "div",
        { class: "stat" },
        h(
          "span",
          { class: "stat-label" },
          icon("wallet"),
          "Insgesamt budgetiert",
        ),
        h("strong", {}, money(data.budget_cents)),
      ),
      h(
        "div",
        { class: "stat" },
        h(
          "span",
          { class: "stat-label" },
          icon("tag"),
          "Offen zu kategorisieren",
        ),
        action(
          `${data.uncategorized_count} Buchungen`,
          () => {
            transactionFilters.uncategorized = true;
            transactionFilters.page = 1;
            ctx.navigate("transactions");
          },
          {
            class: "subtle",
            style: "padding:0;text-align:left;font-size:17px",
          },
        ),
      ),
    ),
  );
  if (ctx.account)
    content.append(
      h(
        "div",
        { class: "notice success" },
        h(
          "p",
          {},
          `${accountName(ctx.state, ctx.account)}: ${money(data.account_expense_cents)} Ausgaben · ${data.account_uncategorized_count} nicht kategorisiert. Budgets, Einkommen und Rest bleiben immer kontoübergreifend.`,
        ),
      ),
    );
  if (data.uncategorized_count)
    content.append(
      h(
        "div",
        { class: "notice" },
        icon("info"),
        action(
          `${data.uncategorized_count} Buchungen warten auf eine Kategorie. Jetzt zuordnen →`,
          () => {
            transactionFilters.uncategorized = true;
            transactionFilters.page = 1;
            ctx.navigate("transactions");
          },
        ),
      ),
    );
  content.append(
    h(
      "div",
      { class: "section-head" },
      h("h2", {}, "Deine Budgets"),
      action("Plan bearbeiten", () => ctx.navigate("budget"), {
        class: "subtle small",
        style: "padding:8px",
      }),
    ),
  );
  const cards = data.categories.map((category) => {
    const available = category.budget_cents + category.carryover_cents;
    const progress = Math.max(
      0,
      Math.min(
        100,
        available > 0
          ? (category.expense_cents / available) * 100
          : category.expense_cents > 0
            ? 100
            : 0,
      ),
    );
    return h(
      "article",
      { class: `category-card${category.remaining_cents < 0 ? " over" : ""}` },
      h(
        "div",
        { class: "category-top" },
        h(
          "div",
          { class: "category-identity" },
          h("span", { class: "category-icon" }, icon("tag")),
          h(
            "div",
            {},
            h("h3", {}, category.name),
            h(
              "span",
              { class: "small muted" },
              category.remaining_cents < 0
                ? "Über dem Budget"
                : "Alles im Blick",
            ),
          ),
        ),
        h(
          "div",
          {},
          h("strong", { class: "rest" }, money(category.remaining_cents)),
          h("span", { class: "rest-label" }, "noch übrig"),
        ),
      ),
      h(
        "div",
        { class: "category-values" },
        h("span", {}, "Ausgegeben ", h("b", {}, money(category.expense_cents))),
        h("span", {}, "Budget ", h("b", {}, money(category.budget_cents))),
      ),
      h(
        "div",
        {
          class: "progress-track",
          role: "progressbar",
          "aria-label": `${category.name}: Budget verbraucht`,
          "aria-valuenow": Math.round(progress),
          "aria-valuemin": 0,
          "aria-valuemax": 100,
        },
        h("div", { class: "progress-fill", style: `width:${progress}%` }),
      ),
      category.carryover_cents
        ? h(
            "p",
            { class: "carry-note" },
            `${money(category.carryover_cents)} Übertrag aus dem Vormonat`,
          )
        : null,
      category.planned_cents
        ? h(
            "p",
            { class: "carry-note" },
            `${money(category.planned_cents)} offen geplant · ${money(category.free_cents)} nach offenen Posten frei`,
          )
        : null,
    );
  });
  content.append(
    cards.length
      ? h("div", { class: "category-list" }, cards)
      : empty(
          "Dein Plan beginnt hier.",
          "Lege Kategorien an und verteile dein Monatsbudget.",
          action("Kategorien verwalten", () => ctx.navigate("categories"), {
            class: "primary",
          }),
        ),
  );
  return content;
}
const transactionFilters = {
  text: "",
  category: "",
  uncategorized: false,
  page: 1,
};
async function transactions() {
  const list = h("div", { class: "transaction-list" });
  const pagination = h("div");
  const count = h("small");
  const offer = h("div");
  const text = input(transactionFilters.text, {
    type: "search",
    placeholder: "Gegenpartei oder Verwendungszweck",
    "aria-label": "Buchungen durchsuchen",
  });
  const category = select(
    [
      { value: "", label: "Alle Kategorien" },
      ...ctx.state.categories.map((item) => ({
        value: item.id,
        label: item.name,
      })),
    ],
    transactionFilters.category,
    { "aria-label": "Kategorie filtern" },
  );
  const account = select(
    [
      { value: "", label: "Alle Konten" },
      ...ctx.state.accounts.map((item) => ({
        value: item.id,
        label: item.name,
      })),
    ],
    ctx.account,
    { "aria-label": "Buchungskonto filtern" },
  );
  const uncategorized = checkbox(
    "Nur nicht kategorisiert",
    transactionFilters.uncategorized,
  );
  let requestId = 0;
  let debounce;
  const load = async () => {
    const id = ++requestId;
    const params = new URLSearchParams({
      month: ctx.month,
      page: transactionFilters.page - 1,
      ...(transactionFilters.text ? { text: transactionFilters.text } : {}),
      ...(ctx.account ? { account_id: ctx.account } : {}),
      ...(transactionFilters.category
        ? { category_id: transactionFilters.category }
        : {}),
      ...(transactionFilters.uncategorized ? { uncategorized: "1" } : {}),
    });
    const data = await ctx.api(`/api/transactions?${params}`);
    if (id !== requestId) return;
    count.textContent = `${data.total} Buchungen`;
    list.replaceChildren(
      ...(data.rows.length
        ? data.rows.map((transaction) => {
            const node = h(
              "div",
              {
                class: "transaction-card",
                "aria-label": `${transaction.counterparty || "Ohne Gegenpartei"} ${money(transaction.amount_cents)} Kategorie ändern`,
              },
              h(
                "div",
                { class: "row" },
                h(
                  "span",
                  { class: "transaction-title" },
                  transaction.counterparty || "Ohne Gegenpartei",
                ),
                h(
                  "span",
                  {
                    class: `transaction-amount${transaction.amount_cents > 0 ? " positive" : ""}`,
                  },
                  money(transaction.amount_cents),
                ),
              ),
              h(
                "div",
                { class: "transaction-meta" },
                h("span", {}, date(transaction.booking_date)),
                h("span", { "aria-hidden": true }, "·"),
                h("span", {}, accountName(ctx.state, transaction.account_id)),
              ),
              transaction.purpose
                ? h("p", { class: "transaction-purpose" }, transaction.purpose)
                : null,
              h(
                "div",
                { class: "transaction-labels" },
                h(
                  "span",
                  {
                    class: `tag category-tag${transaction.category_id ? "" : " warning"}`,
                  },
                  icon("tag"),
                  categoryName(ctx.state, transaction.category_id),
                ),
                transaction.category_source === "manual"
                  ? h("span", { class: "small muted" }, "Manuell")
                  : null,
                transaction.paypal_details?.length
                  ? h("span", { class: "tag paid" }, "PayPal verknüpft")
                  : null,
              ),
            );
            node.addEventListener("click", (event) => {
              if (!event.target.closest(".category-tag")) return;
              const dialog = modal("Kategorie wählen");
              dialog.body.append(
                h("p", { class: "small muted" }, transaction.counterparty),
                h(
                  "div",
                  { class: "category-options" },
                  [
                    { id: null, name: "Nicht kategorisiert" },
                    ...ctx.state.categories,
                  ].map((item) =>
                    action(
                      item.name,
                      async () => {
                        await ctx.api(
                          `/api/transactions/${transaction.id}/category`,
                          "POST",
                          { category_id: item.id },
                        );
                        dialog.close();
                        await load();
                        if (item.id)
                          offer.replaceChildren(
                            h(
                              "div",
                              { class: "rule-offer" },
                              h(
                                "p",
                                {},
                                `„${transaction.counterparty}“ ist jetzt ${item.name}. Für das nächste Mal merken?`,
                              ),
                              action("Regel daraus erstellen", () =>
                                ruleEditor(ctx, null, {
                                  match_text: transaction.counterparty,
                                  category_id: item.id,
                                }),
                              ),
                              action(
                                "Nicht jetzt",
                                () => offer.replaceChildren(),
                                { class: "subtle" },
                              ),
                            ),
                          );
                        notify("Kategorie geändert.");
                      },
                      {
                        class:
                          transaction.category_id === item.id ? "selected" : "",
                      },
                    ),
                  ),
                ),
              );
            });
            if (!transaction.paypal_details?.length) return node;
            return h(
              "div",
              {},
              node,
              h(
                "details",
                { style: "margin-top:8px" },
                h(
                  "summary",
                  {},
                  `PayPal-Details (${transaction.paypal_details.length})`,
                ),
                h(
                  "p",
                  {},
                  "Ergänzende Händlerangaben. Betrag und Kategorie stammen weiterhin aus deiner Bankbuchung.",
                ),
                transaction.paypal_details.map((detail) =>
                  h(
                    "div",
                    { class: "preview-row" },
                    h(
                      "div",
                      { class: "row" },
                      h("strong", {}, detail.counterparty || "Ohne Händlerangabe"),
                      h("strong", {}, money(detail.amount_cents)),
                    ),
                    h(
                      "p",
                      {},
                      `${date(detail.booking_date)} · ${detail.paypal_kind === "refund" ? "Rückerstattung" : "Zahlung"}`,
                    ),
                    detail.purpose ? h("p", {}, detail.purpose) : null,
                    detail.external_id
                      ? h(
                          "p",
                          { style: "overflow-wrap:anywhere" },
                          `PayPal-Transaktionscode: ${detail.external_id}`,
                        )
                      : null,
                    detail.related_external_id
                      ? h(
                          "p",
                          { style: "overflow-wrap:anywhere" },
                          `Zugehöriger Transaktionscode: ${detail.related_external_id}`,
                        )
                      : null,
                  ),
                ),
              ),
            );
          })
        : [
            empty(
              "Keine Buchungen gefunden.",
              "Passe die Filter an oder importiere die Buchungen dieses Monats.",
              action("CSV importieren", () => ctx.navigate("import"), {
                class: "primary",
              }),
            ),
          ]),
    );
    const pages = Math.max(1, Math.ceil(data.total / 50));
    pagination.replaceChildren(
      h(
        "div",
        { class: "pagination" },
        action(
          "Zurück",
          async () => {
            transactionFilters.page--;
            await load();
          },
          { class: "outline", disabled: transactionFilters.page <= 1 },
        ),
        h("span", {}, `Seite ${transactionFilters.page} von ${pages}`),
        action(
          "Weiter",
          async () => {
            transactionFilters.page++;
            await load();
            list.scrollIntoView({ block: "start" });
          },
          { class: "outline", disabled: transactionFilters.page >= pages },
        ),
      ),
    );
  };
  const change = () => {
    transactionFilters.page = 1;
    return load().catch((error) => notify(error.message, true));
  };
  text.addEventListener("input", () => {
    transactionFilters.text = text.value;
    clearTimeout(debounce);
    debounce = setTimeout(change, 180);
  });
  category.addEventListener("change", () => {
    transactionFilters.category = category.value;
    change();
  });
  account.addEventListener("change", () => {
    ctx.account = account.value;
    change();
  });
  uncategorized.control.addEventListener("change", () => {
    transactionFilters.uncategorized = uncategorized.control.checked;
    change();
  });
  await load();
  return h(
    "div",
    {},
    heading(
      "Was rein- und rausgeht.",
      "Deine Buchungen. Klar sortiert. Schnell zugeordnet.",
      "Buchungen",
    ),
    ctx.monthToolbar(false),
    h(
      "div",
      { class: "filters" },
      h("div", { class: "search-wrap" }, icon("search"), text),
      h("div", { class: "filter-row" }, category, account),
      uncategorized.node,
    ),
    h("div", { class: "section-head" }, h("h2", {}, "Alle Bewegungen"), count),
    list,
    pagination,
    offer,
  );
}
async function more() {
  const entries = [
    ["accounts", "Konten", "bank", "Giro, Tagesgeld & Kreditkarte"],
    ["categories", "Kategorien", "tag", "Deine Ordnung, deine Kategorien"],
    ["rules", "Regeln", "repeat", "Weniger Routine, mehr Überblick"],
    ["recurring", "Feste Posten", "calendar", "Regelmäßige Kosten & Zahlungen"],
    ["transfers", "Umbuchungen", "arrow", "Zwischen deinen eigenen Konten"],
    [
      "setup",
      "Einrichtungs-Assistent",
      "leaf",
      "Fortsetzen oder erneut durchgehen",
    ],
  ];
  return h(
    "div",
    {},
    heading(
      "Ganz nach deinem Alltag.",
      "Die kleinen Einstellungen für den großen Überblick.",
      "Mehr Möglichkeiten",
    ),
    h(
      "div",
      { class: "menu-grid" },
      entries.map(([route, title, glyph, subtitle]) =>
        menuItem(route, title, glyph, subtitle),
      ),
    ),
    h(
      "div",
      { class: "card", style: "margin-top:25px" },
      h(
        "div",
        { class: "row" },
        h(
          "div",
          {},
          h("h3", {}, "Privat bleibt privat."),
          h(
            "p",
            { class: "small muted" },
            "Keine Cloud. Kein Tracking. Dein eigener Server.",
          ),
        ),
        icon("shield"),
      ),
      h("div", { class: "divider" }),
      action(
        "Abmelden",
        async () => {
          await ctx.api("/api/auth/logout", "POST", {});
          auth = await ctx.api("/api/auth");
          csrf = auth.csrf;
          history.replaceState(null, "", "/");
          renderAuth();
        },
        { class: "outline", icon: "logout" },
      ),
    ),
  );
}
function menuItem(route, title, glyph, subtitle) {
  return h(
    "button",
    {
      type: "button",
      class: "menu-item",
      "aria-label": title,
      onclick: () => ctx.navigate(route),
    },
    h("span", { class: "menu-icon" }, icon(glyph)),
    h("span", {}, title, h("small", {}, subtitle)),
    h("span", { class: "chevron" }, icon("right")),
  );
}
window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  ctx.render();
});
async function boot() {
  try {
    auth = await ctx.api("/api/auth");
    csrf = auth.csrf;
    if (auth.authenticated) await start();
    else renderAuth();
  } catch (error) {
    root.replaceChildren(
      h(
        "main",
        { class: "auth-layout" },
        brand(),
        h("h1", {}, "Verbindung fehlt."),
        h(
          "p",
          { class: "muted" },
          "Die App braucht eine Verbindung zu deinem Server. Es werden keine Finanzdaten offline gespeichert.",
        ),
        h("p", { class: "small muted" }, error.message),
        action("Erneut verbinden", boot, { class: "primary" }),
      ),
    );
  }
}
if ("serviceWorker" in navigator && window.isSecureContext)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
boot();
