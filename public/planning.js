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
  confirmAction,
  heading,
  empty,
  categoryOptions,
  budgetable,
  categoryName,
  accountName,
  notify,
  money,
  cents,
  date,
  decimal,
  transactionPreview,
  moneyControl,
} from "./ui.js";

export function budgetFields(ctx, amounts) {
  const controls = new Map();
  const total = h("strong");
  const update = () => {
    let sum = 0;
    for (const control of controls.values()) {
      try {
        sum += cents(control.value);
      } catch {
        /* Invalid input is explained on submit. */
      }
    }
    total.textContent = money(sum);
  };
  const node = h(
    "div",
    { class: "card" },
    ctx.state.categories.filter(budgetable).map((category) => {
      const control = moneyControl(
        amounts.find(
          (amount) => Number(amount.category_id ?? amount.id) === category.id,
        )?.amount_cents ??
          amounts.find((amount) => Number(amount.id) === category.id)
            ?.budget_cents ??
          0,
        `Budget ${category.name}`,
      );
      controls.set(category.id, control);
      control.addEventListener("input", update);
      const id = `budget-${category.id}`;
      control.id = id;
      return h(
        "div",
        { class: "budget-line" },
        h("label", { for: id }, category.name),
        h("div", { class: "money-input" }, control, h("span", {}, "€")),
      );
    }),
    h(
      "div",
      { class: "row budget-total" },
      h("span", {}, "Insgesamt verplant"),
      total,
    ),
  );
  update();
  return {
    node,
    values: () =>
      [...controls].map(([category_id, control]) => ({
        category_id,
        amount_cents: cents(control.value),
      })),
  };
}
export async function budget(ctx) {
  const data = await ctx.api(`/api/dashboard?month=${ctx.month}`);
  const fields = budgetFields(
    ctx,
    data.categories.map((category) => ({
      category_id: category.id,
      amount_cents: category.budget_cents,
    })),
  );
  return h(
    "div",
    {},
    heading(
      "Ein Plan für dein Geld.",
      "Budgets gelten gemeinsam für alle Konten.",
      "Monatsbudget",
    ),
    ctx.monthToolbar(false),
    h(
      "div",
      { class: "notice success" },
      h(
        "p",
        {},
        `Planungsbasis: ${money(data.planning_income_cents)} · ${data.income_source === "actual" ? "tatsächlich" : "Vormonat (Annahme)"}${data.income_basis_missing ? " · keine Basis vorhanden" : ""}`,
      ),
    ),
    form(
      async () => {
        await ctx.api("/api/budgets", "POST", {
          month: ctx.month,
          amounts: fields.values(),
          replace: true,
        });
        notify("Monatsbudget gespeichert.");
        await ctx.render();
      },
      fields.node,
      h("button", { type: "submit", class: "primary" }, "Budget speichern"),
    ),
    h(
      "p",
      { class: "small muted", style: "margin-top:16px" },
      "Neue Monate übernehmen das Budget des Vormonats, solange du nichts anderes speicherst. Einkommen und ausgenommene Kategorien werden nicht budgetiert.",
    ),
  );
}
function transferCard(ctx, pair, confirmed) {
  const outgoing = pair.outgoing;
  const incoming = pair.incoming;
  const endpoint = (transaction) =>
    h(
      "div",
      { class: "transfer-endpoint" },
      h(
        "div",
        {},
        h("strong", {}, accountName(ctx.state, transaction.account_id)),
        h("div", { class: "muted" }, transaction.counterparty),
        h("small", { class: "muted" }, date(transaction.booking_date)),
      ),
      h("strong", {}, money(transaction.amount_cents)),
    );
  return h(
    "div",
    { class: "transfer-card" },
    endpoint(outgoing),
    h("div", { class: "transfer-divider", "aria-hidden": true }, "↓"),
    endpoint(incoming),
    confirmed
      ? h(
          "div",
          { class: "tag paid", style: "margin-top:12px" },
          "Bestätigte Umbuchung",
        )
      : null,
    action(
      confirmed ? "Umbuchung aufheben" : "Als Umbuchung bestätigen",
      async () => {
        if (confirmed) {
          if (
            !(await confirmAction(
              "Umbuchung aufheben?",
              "Die Verknüpfung wird entfernt. Die vorherigen Kategoriezuordnungen beider Buchungen werden wiederhergestellt.",
              "Aufheben",
            ))
          )
            return;
          await ctx.api(`/api/transfers/${pair.id}`, "DELETE");
        } else {
          const categories = categoryOptions(
            ctx.state,
            (category) => category.is_excluded && !category.is_income,
          );
          if (!categories.length)
            throw new Error(
              "Lege zuerst eine vom Budget ausgenommene Kategorie an.",
            );
          const dialog = modal("Umbuchung bestätigen");
          const category = select(categories, categories[0]?.value, {
            required: true,
          });
          dialog.body.append(
            form(
              async () => {
                await ctx.api("/api/transfers", "POST", {
                  outgoing_id: outgoing.id,
                  incoming_id: incoming.id,
                  category_id: Number(category.value),
                });
                dialog.close();
                await ctx.refresh();
                await ctx.render();
                notify(
                  "Umbuchung bestätigt. Beide Buchungen zählen nicht als Einnahmen oder Ausgaben.",
                );
              },
              h(
                "p",
                { class: "small muted" },
                "Beide Buchungen werden manuell dieser ausgeschlossenen Kategorie zugeordnet. Jede Buchung kann nur zu einem Paar gehören.",
              ),
              field("Zielkategorie", category),
              h(
                "div",
                { class: "form-actions" },
                action("Abbrechen", () => dialog.close(), { class: "outline" }),
                h(
                  "button",
                  { type: "submit", class: "primary" },
                  "Paar bestätigen",
                ),
              ),
            ),
          );
          return;
        }
        await ctx.refresh();
        await ctx.render();
        notify("Umbuchung aufgehoben.");
      },
      { class: confirmed ? "outline" : "primary" },
    ),
  );
}
export async function transferPanel(ctx) {
  const data = await ctx.api("/api/transfers");
  return h(
    "div",
    {},
    h(
      "p",
      { class: "small muted" },
      "Gleicher Betrag, zwei eigene Konten, höchstens drei Tage Abstand. Du entscheidest, welche Buchungen zusammengehören. Kreditkarten-Sammelabbuchungen sind Umbuchungen; einzelne Kartenzahlungen bleiben Ausgaben.",
    ),
    h(
      "div",
      { class: "section-head" },
      h("h2", {}, "Vorschläge"),
      h("small", {}, `${data.suggestions.length} mögliche Paare`),
    ),
    data.suggestions.length
      ? data.suggestions.map((pair) => transferCard(ctx, pair, false))
      : empty(
          "Hier ist alles sortiert.",
          "Aktuell gibt es keine offenen Umbuchungsvorschläge.",
        ),
    data.pairs.length
      ? h(
          "div",
          {},
          h("div", { class: "section-head" }, h("h2", {}, "Bestätigte Paare")),
          data.pairs.map((pair) => transferCard(ctx, pair, true)),
        )
      : null,
  );
}
export async function transfers(ctx) {
  return h(
    "div",
    {},
    heading(
      "Von dir. An dich.",
      "Interne Geldbewegungen ohne doppelte Ausgaben.",
      "Umbuchungen",
    ),
    await transferPanel(ctx),
  );
}
export function recurringEditor(ctx, existing) {
  const dialog = modal(
    existing ? "Festen Posten bearbeiten" : "Festen Posten hinzufügen",
  );
  const name = input(existing?.name || "", { required: true, maxlength: 150 });
  const amount = moneyControl(existing?.amount_cents || 0, "Betrag");
  const interval = select(
    [
      { value: "monthly", label: "Monatlich" },
      { value: "quarterly", label: "Vierteljährlich" },
      { value: "yearly", label: "Jährlich" },
    ],
    existing?.interval || "monthly",
  );
  const firstDate = input(existing?.first_due_date || `${ctx.month}-01`, {
    type: "date",
    required: true,
  });
  const category = select(
    categoryOptions(ctx.state, budgetable),
    existing?.category_id,
    { required: true },
  );
  const hint = input(existing?.counterparty_hint || "", { maxlength: 250 });
  dialog.body.append(
    form(
      async () => {
        await ctx.api(
          `/api/recurring-items${existing ? `/${existing.id}` : ""}`,
          existing ? "PUT" : "POST",
          {
            name: name.value,
            amount_cents: cents(amount.value),
            interval: interval.value,
            first_due_date: firstDate.value,
            category_id: Number(category.value),
            counterparty_hint: hint.value,
          },
        );
        dialog.close();
        await ctx.refresh();
        await ctx.render();
        notify("Fester Posten gespeichert.");
      },
      h(
        "div",
        { class: "form-grid" },
        field("Name", name),
        field("Betrag in Euro", amount),
        field("Intervall", interval),
        field(
          "Erste Fälligkeit",
          firstDate,
          "Am 31. fällige Posten fallen in kürzeren Monaten auf den letzten Tag.",
        ),
        field("Kategorie", category),
        field(
          "Gegenpartei-Hinweis",
          hint,
          "Für Zahlungsvorschläge muss die Gegenpartei genau passen (Großschreibung und Leerzeichen werden vereinheitlicht). Ohne Hinweis gibt es keine Vorschläge.",
        ),
        existing
          ? h(
              "p",
              { class: "small muted" },
              "Änderungen gelten nur für noch nicht bestätigte Fälligkeiten. Bereits bestätigte Zahlungen behalten ihren Sollstand.",
            )
          : null,
      ),
      h(
        "div",
        { class: "form-actions" },
        action("Abbrechen", () => dialog.close(), { class: "outline" }),
        h("button", { type: "submit", class: "primary" }, "Speichern"),
      ),
    ),
  );
}
export async function recurring(ctx) {
  const data = await ctx.api(`/api/recurring?month=${ctx.month}`);
  const occurrenceCards = data.occurrences.map((occurrence) => {
    const matches = data.suggestions.filter(
      (suggestion) => suggestion.occurrence_id === occurrence.id,
    );
    const paid = Boolean(occurrence.matched_transaction_id);
    const card = h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h(
          "div",
          {},
          h("h3", {}, occurrence.name),
          h(
            "p",
            { class: "small muted" },
            `${date(occurrence.due_date)} · ${categoryName(ctx.state, occurrence.category_id)}`,
          ),
        ),
        h("strong", {}, money(occurrence.amount_cents)),
      ),
      h(
        "span",
        { class: `tag ${paid ? "paid" : "warning"}` },
        paid ? "Bezahlt" : "Offen geplant",
      ),
    );
    if (paid)
      card.append(
        h(
          "div",
          { class: "form-actions" },
          action(
            "Zahlungsbestätigung aufheben",
            async () => {
              if (
                await confirmAction(
                  "Zahlung lösen?",
                  "Die Fälligkeit wird wieder als offen geplant. Die vorherige Kategoriezuordnung der Buchung wird wiederhergestellt.",
                  "Aufheben",
                )
              ) {
                await ctx.api(
                  `/api/recurring/match/${occurrence.id}`,
                  "DELETE",
                );
                await ctx.render();
              }
            },
            { class: "outline" },
          ),
        ),
      );
    else if (matches.length)
      card.append(
        h("div", { class: "divider" }),
        h(
          "p",
          { class: "small muted" },
          matches.length > 1
            ? "Mehrere passende Zahlungen. Wähle die richtige:"
            : "Mögliche Zahlung gefunden:",
        ),
        matches.map((suggestion) =>
          h(
            "div",
            {},
            transactionPreview(suggestion.transaction, ctx.state),
            action(
              "Zahlung prüfen",
              () => {
                const dialog = modal("Zahlung bestätigen");
                const approval = checkbox(
                  `Buchung ausdrücklich der Kategorie „${categoryName(ctx.state, occurrence.category_id)}“ zuordnen`,
                  false,
                );
                const confirm = action(
                  "Zahlung bestätigen",
                  async () => {
                    await ctx.api("/api/recurring/match", "POST", {
                      occurrence_id: occurrence.id,
                      transaction_id: suggestion.transaction.id,
                      confirm_category: approval.control.checked,
                    });
                    dialog.close();
                    await ctx.render();
                    notify("Zahlung bestätigt.");
                  },
                  { class: "primary" },
                );
                dialog.body.append(
                  transactionPreview(suggestion.transaction, ctx.state),
                  h(
                    "p",
                    { class: "small muted", style: "margin-top:14px" },
                    "Die Bestätigung löst nur die offene Reservierung. Die importierte Buchung zählt einmal in ihrem Buchungsmonat als Ausgabe. Ohne deine Zustimmung bleibt ihre Kategorie unverändert.",
                  ),
                  approval.node,
                  h(
                    "div",
                    { class: "form-actions" },
                    action("Abbrechen", () => dialog.close(), {
                      class: "outline",
                    }),
                    confirm,
                  ),
                );
              },
              { class: "outline", style: "margin:10px 0" },
            ),
          ),
        ),
      );
    return card;
  });
  const intervals = {
    monthly: "monatlich",
    quarterly: "vierteljährlich",
    yearly: "jährlich",
  };
  const itemList = h("div", { class: "card" });
  for (const item of ctx.state.recurring_items) {
    const edit = action("Bearbeiten", () => recurringEditor(ctx, item), {
      class: "icon-button subtle",
      icon: "edit",
      iconOnly: true,
      "aria-label": `${item.name} bearbeiten`,
    });
    const remove = action(
      "Löschen",
      async () => {
        if (
          !(await confirmAction(
            "Festen Posten löschen?",
            "Nur ohne bestätigte Zahlungen löschbar. Hebe bestätigte Zahlungen zuerst auf; danach werden der Posten und seine offenen Fälligkeiten gelöscht.",
            "Löschen",
          ))
        )
          return;
        await ctx.api(`/api/recurring-items/${item.id}`, "DELETE");
        await ctx.refresh();
        await ctx.render();
      },
      {
        class: "icon-button subtle",
        icon: "trash",
        iconOnly: true,
        "aria-label": `${item.name} löschen`,
      },
    );
    itemList.append(
      h(
        "div",
        { class: "list-row" },
        h(
          "div",
          { class: "list-copy" },
          h("strong", {}, item.name),
          h(
            "small",
            {},
            `${money(item.amount_cents)} · ${intervals[item.interval]} · ${categoryName(ctx.state, item.category_id)}`,
          ),
        ),
        h("div", { class: "list-actions" }, edit, remove),
      ),
    );
  }
  return h(
    "div",
    {},
    heading(
      "Das läuft regelmäßig.",
      "Feste Kosten im Blick, offene Zahlungen bewusst bestätigen.",
      "Feste Posten",
    ),
    ctx.monthToolbar(false),
    h("div", { class: "section-head" }, h("h2", {}, "Fälligkeiten im Monat")),
    occurrenceCards.length
      ? occurrenceCards
      : empty(
          "In diesem Monat ist nichts fällig.",
          "Lege einen festen Posten an, um wiederkehrende Kosten einzuplanen.",
        ),
    h("div", { class: "section-head" }, h("h2", {}, "Deine festen Posten")),
    ctx.state.recurring_items.length ? itemList : null,
    action("Festen Posten hinzufügen", () => recurringEditor(ctx), {
      class: "primary",
    }),
  );
}
