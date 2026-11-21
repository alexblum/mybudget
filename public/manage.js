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
  notify,
} from "./ui.js";

export function accountEditor(ctx, existing) {
  const dialog = modal(existing ? "Konto bearbeiten" : "Konto hinzufügen");
  const name = input(existing?.name || "", {
    required: true,
    maxlength: 100,
    autocomplete: "off",
  });
  const type = select(
    ["Giro", "Tagesgeld", "Kreditkarte", "sonstiges"].map((value) => ({
      value,
      label: value === "sonstiges" ? "Sonstiges" : value,
    })),
    existing?.type || "Giro",
  );
  dialog.body.append(
    form(
      async () => {
        await ctx.api(
          `/api/accounts${existing ? `/${existing.id}` : ""}`,
          existing ? "PUT" : "POST",
          { name: name.value, type: type.value },
        );
        dialog.close();
        await ctx.refresh();
        await ctx.render();
        notify("Konto gespeichert.");
      },
      h(
        "div",
        { class: "form-grid" },
        field("Name", name),
        field("Kontotyp", type),
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
export function accountList(ctx) {
  const list = h("div");
  if (!ctx.state.accounts.length)
    list.append(
      empty(
        "Platz für dein erstes Konto",
        "Girokonto, Tagesgeld oder Kreditkarte: Du entscheidest, welche Konten du einbeziehen möchtest.",
      ),
    );
  else
    list.append(
      h(
        "div",
        { class: "card" },
        ctx.state.accounts.map((account) =>
          h(
            "div",
            { class: "list-row" },
            h(
              "div",
              { class: "list-copy" },
              h("strong", {}, account.name),
              h("small", {}, account.type),
            ),
            h(
              "div",
              { class: "list-actions" },
              action("Konto bearbeiten", () => accountEditor(ctx, account), {
                class: "icon-button subtle",
                icon: "edit",
                iconOnly: true,
                "aria-label": `${account.name} bearbeiten`,
              }),
              action(
                "Konto löschen",
                async () => {
                  if (
                    await confirmAction(
                      "Konto löschen?",
                      `${account.name} kann nur gelöscht werden, wenn keine Buchungen vorhanden sind. Import-Profile werden ebenfalls entfernt.`,
                      "Löschen",
                    )
                  ) {
                    await ctx.api(`/api/accounts/${account.id}`, "DELETE");
                    await ctx.refresh();
                    await ctx.render();
                  }
                },
                {
                  class: "icon-button subtle danger-text",
                  icon: "trash",
                  iconOnly: true,
                  "aria-label": `${account.name} löschen`,
                },
              ),
            ),
          ),
        ),
      ),
    );
  list.append(
    action("Konto hinzufügen", () => accountEditor(ctx), { class: "primary" }),
  );
  return list;
}
export async function accounts(ctx) {
  return h(
    "div",
    {},
    heading("Deine Konten", "Mehrere Konten. Ein gemeinsamer Überblick."),
    accountList(ctx),
  );
}

function categoryEditor(ctx, existing) {
  const dialog = modal(
    existing ? "Kategorie bearbeiten" : "Kategorie hinzufügen",
  );
  const name = input(existing?.name || "", { required: true, maxlength: 100 });
  const order = input(existing?.sort_order ?? ctx.state.categories.length, {
    type: "number",
    step: 1,
    required: true,
  });
  const kind = select(
    [
      { value: "budget", label: "Budgetkategorie" },
      { value: "income", label: "Einkommen" },
      { value: "excluded", label: "Vom Budget ausgenommen" },
    ],
    existing?.is_income
      ? "income"
      : existing?.is_excluded
        ? "excluded"
        : "budget",
  );
  const carry = checkbox(
    "Übriges oder überzogenes Budget in den nächsten Monat übertragen",
    Boolean(existing?.carryover_enabled),
  );
  const sync = () => {
    carry.control.disabled = kind.value !== "budget";
    if (carry.control.disabled) carry.control.checked = false;
  };
  kind.addEventListener("change", sync);
  sync();
  dialog.body.append(
    form(
      async () => {
        if (
          existing &&
          Number(carry.control.checked) !== existing.carryover_enabled &&
          !(await confirmAction(
            "Übertrag rückwirkend ändern?",
            "Diese Einstellung gilt für die gesamte Historie. Alle monatlichen Überträge und Folgereste dieser Kategorie werden neu berechnet.",
            "Änderung bestätigen",
          ))
        )
          return;
        await ctx.api(
          `/api/categories${existing ? `/${existing.id}` : ""}`,
          existing ? "PUT" : "POST",
          {
            name: name.value,
            sort_order: Number(order.value),
            carryover_enabled: Number(carry.control.checked),
            is_income: Number(kind.value === "income"),
            is_excluded: Number(kind.value === "excluded"),
          },
        );
        dialog.close();
        await ctx.refresh();
        await ctx.render();
        notify("Kategorie gespeichert.");
      },
      h(
        "div",
        { class: "form-grid" },
        field("Name", name),
        field("Reihenfolge", order, "Kleinere Zahlen stehen weiter oben."),
        field("Art der Kategorie", kind),
        carry.node,
        h(
          "p",
          { class: "small muted" },
          "Einkommen und ausgenommene Kategorien haben kein Budget und keinen Übertrag. Bereits verwendete Budgetkategorien können ihre Art erst nach Auflösung der Referenzen ändern.",
        ),
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
function deleteCategory(ctx, category) {
  const dialog = modal("Kategorie löschen");
  const options = ctx.state.categories.filter(
    (item) =>
      item.id !== category.id &&
      Boolean(item.is_income) === Boolean(category.is_income) &&
      Boolean(item.is_excluded) === Boolean(category.is_excluded),
  );
  const replacement = select(
    [
      { value: "", label: "Ohne Ersatz (nur unbenutzt möglich)" },
      ...options.map((item) => ({ value: item.id, label: item.name })),
    ],
    "",
  );
  dialog.body.append(
    form(
      async () => {
        await ctx.api(`/api/categories/${category.id}`, "DELETE", {
          replacement_id: replacement.value ? Number(replacement.value) : null,
        });
        dialog.close();
        await ctx.refresh();
        await ctx.render();
        notify("Kategorie gelöscht.");
      },
      h(
        "p",
        { class: "small muted" },
        `„${category.name}“ entfernen? Vorhandene Buchungen, Regeln, Budgets und feste Posten benötigen eine kompatible Ersatzkategorie. Budgets desselben Monats werden addiert.`,
      ),
      field("Ersatzkategorie", replacement),
      h(
        "div",
        { class: "form-actions" },
        action("Abbrechen", () => dialog.close(), { class: "outline" }),
        h("button", { type: "submit", class: "danger" }, "Kategorie löschen"),
      ),
    ),
  );
}
export async function categories(ctx) {
  return h(
    "div",
    {},
    heading(
      "Alles hat seinen Platz.",
      "Deine Kategorien passen sich deinem Alltag an.",
      "Kategorien",
    ),
    h(
      "div",
      { class: "card" },
      ctx.state.categories.map((category) =>
        h(
          "div",
          { class: "list-row" },
          h(
            "div",
            { class: "list-copy" },
            h("strong", {}, category.name),
            h(
              "small",
              {},
              `Position ${category.sort_order} · ${category.is_income ? "Einkommen" : category.is_excluded ? "Ausgenommen" : category.carryover_enabled ? "Budget · Übertrag aktiv" : "Budget · ohne Übertrag"}`,
            ),
          ),
          h(
            "div",
            { class: "list-actions" },
            action("Bearbeiten", () => categoryEditor(ctx, category), {
              class: "icon-button subtle",
              icon: "edit",
              iconOnly: true,
              "aria-label": `${category.name} bearbeiten`,
            }),
            action("Löschen", () => deleteCategory(ctx, category), {
              class: "icon-button subtle",
              icon: "trash",
              iconOnly: true,
              "aria-label": `${category.name} löschen`,
            }),
          ),
        ),
      ),
    ),
    action("Kategorie hinzufügen", () => categoryEditor(ctx), {
      class: "primary",
    }),
  );
}
export function ruleEditor(ctx, existing, draft = {}) {
  const dialog = modal(existing ? "Regel bearbeiten" : "Regel erstellen");
  const values = existing || draft;
  const text = input(values.match_text || "", {
    required: true,
    maxlength: 250,
  });
  const matchField = select(
    [
      { value: "counterparty", label: "Gegenpartei" },
      { value: "purpose", label: "Verwendungszweck" },
      { value: "both", label: "Gegenpartei oder Verwendungszweck" },
    ],
    values.match_field || "counterparty",
  );
  const category = select(
    categoryOptions(ctx.state),
    values.category_id || ctx.state.categories[0]?.id,
    { required: true },
  );
  const priority = input(values.priority ?? 100, {
    type: "number",
    required: true,
    step: 1,
  });
  dialog.body.append(
    form(
      async () => {
        await ctx.api(
          `/api/rules${existing ? `/${existing.id}` : ""}`,
          existing ? "PUT" : "POST",
          {
            match_text: text.value,
            match_field: matchField.value,
            category_id: Number(category.value),
            priority: Number(priority.value),
          },
        );
        dialog.close();
        await ctx.refresh();
        await ctx.render();
        notify("Regel gespeichert. Manuelle Zuordnungen bleiben erhalten.");
      },
      h(
        "div",
        { class: "form-grid" },
        field(
          "Enthält den Suchtext",
          text,
          "Groß- und Kleinschreibung spielen keine Rolle.",
        ),
        field("Suchen in", matchField),
        field("Zielkategorie", category),
        field(
          "Priorität",
          priority,
          "Kleinere Zahl gewinnt. Bei Gleichstand gewinnt die ältere Regel.",
        ),
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
export async function rules(ctx) {
  const preview = async () => {
    const data = await ctx.api("/api/rules/apply", "POST", { confirm: false });
    const changes = Array.isArray(data.changes) ? data.changes : [];
    const total =
      typeof data.changes === "number" ? data.changes : changes.length;
    const dialog = modal("Regelvorschau");
    dialog.body.append(
      h(
        "p",
        { class: "small muted" },
        `${total} Buchungen würden neu zugeordnet. Manuelle Kategorien bleiben unverändert.`,
      ),
    );
    if (changes.length)
      dialog.body.append(
        h(
          "div",
          { class: "preview-list" },
          changes.map((change) =>
            h(
              "div",
              { class: "preview-row" },
              h(
                "strong",
                {},
                change.counterparty ||
                  `Buchung ${change.id || change.transaction_id}`,
              ),
              h(
                "div",
                {},
                `${categoryName(ctx.state, change.previous_category_id)} → ${categoryName(ctx.state, change.category_id)}`,
              ),
            ),
          ),
        ),
      );
    dialog.body.append(
      h(
        "div",
        { class: "form-actions" },
        action("Abbrechen", () => dialog.close(), { class: "outline" }),
        action(
          "Änderungen anwenden",
          async () => {
            await ctx.api("/api/rules/apply", "POST", { confirm: true });
            dialog.close();
            await ctx.refresh();
            await ctx.render();
            notify("Regeln angewendet.");
          },
          { class: "primary", disabled: !total },
        ),
      ),
    );
  };
  const list = h("div", { class: "card" });
  for (const rule of [...ctx.state.rules].sort(
    (a, b) => a.priority - b.priority || a.id - b.id,
  )) {
    const remove = action(
      "Löschen",
      async () => {
        if (
          !(await confirmAction(
            "Regel löschen?",
            "Bestehende Kategorien bleiben unverändert.",
            "Löschen",
          ))
        )
          return;
        await ctx.api(`/api/rules/${rule.id}`, "DELETE");
        await ctx.refresh();
        await ctx.render();
      },
      {
        class: "icon-button subtle",
        icon: "trash",
        iconOnly: true,
        "aria-label": `Regel ${rule.match_text} löschen`,
      },
    );
    const edit = action("Bearbeiten", () => ruleEditor(ctx, rule), {
      class: "icon-button subtle",
      icon: "edit",
      iconOnly: true,
      "aria-label": `Regel ${rule.match_text} bearbeiten`,
    });
    const label =
      rule.match_field === "both"
        ? "Beide Felder"
        : rule.match_field === "purpose"
          ? "Verwendungszweck"
          : "Gegenpartei";
    list.append(
      h(
        "div",
        { class: "list-row" },
        h(
          "div",
          { class: "list-copy" },
          h("strong", {}, rule.match_text),
          h(
            "small",
            {},
            `${label} → ${categoryName(ctx.state, rule.category_id)} · Priorität ${rule.priority}`,
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
      "Einmal ordnen. Immer klar.",
      "Regeln übernehmen die Routine – du behältst die Kontrolle.",
      "Regeln",
    ),
    h(
      "div",
      { class: "page-actions" },
      action("Regel hinzufügen", () => ruleEditor(ctx), { class: "primary" }),
      action("Bestehende Buchungen prüfen", preview, { class: "outline" }),
    ),
    h(
      "div",
      { class: "section-head" },
      h("h2", {}, "Deine Regeln"),
      h("small", {}, `${ctx.state.rules.length} Regeln`),
    ),
    ctx.state.rules.length
      ? list
      : empty(
          "Deine erste kleine Automatik",
          "Lege eine Regel an oder erstelle sie direkt aus einer korrigierten Buchung.",
        ),
  );
}
