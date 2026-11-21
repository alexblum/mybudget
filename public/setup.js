import {
  h,
  action,
  input,
  select,
  field,
  form,
  checkbox,
  heading,
  empty,
  notify,
  categoryOptions,
  budgetable,
  money,
  cents,
  currentMonth,
  transactionPreview,
  confirmAction,
} from "./ui.js";
import { accountList } from "./manage.js";
import { importPanel } from "./import.js";
import { budgetFields, transferPanel } from "./planning.js";

const steps = [
  "Konten anlegen",
  "Historie importieren",
  "Gruppen zuordnen",
  "Einkommen & feste Kosten",
  "Dein Start-Budget",
  "Alles im Überblick",
];
let skippedGroups = new Set();
let skippedHistory = new Set();
async function persistSkipped(ctx) {
  await ctx.api("/api/setup", "PUT", {
    step: ctx.state.setup.step,
    skipped_groups: [...skippedGroups],
    skipped_history: [...skippedHistory],
  });
  await ctx.refresh();
}
async function go(ctx, step) {
  await ctx.api("/api/setup", "PUT", { step });
  await ctx.refresh();
  await ctx.render();
  window.scrollTo(0, 0);
}
export async function setup(ctx) {
  skippedGroups = new Set(ctx.state.setup.skipped_groups || []);
  skippedHistory = new Set(ctx.state.setup.skipped_history || []);
  const step = Math.max(0, Math.min(5, Number(ctx.state.setup.step) || 0));
  const root = h("div");
  root.append(
    h(
      "div",
      { class: "setup-top-tools" },
      action("Später fortsetzen", () => ctx.navigate("dashboard"), {
        class: "subtle",
      }),
      action(
        "Von vorn beginnen",
        async () => {
          if (
            step &&
            !(await confirmAction(
              "Assistent neu durchgehen?",
              "Bereits bestätigte Konten, Buchungen, Regeln und Posten bleiben erhalten. Es werden keine Daten gelöscht.",
              "Neu beginnen",
            ))
          )
            return;
          skippedGroups.clear();
          skippedHistory.clear();
          await persistSkipped(ctx);
          await go(ctx, 0);
        },
        { class: "subtle" },
      ),
    ),
    h(
      "div",
      { class: "setup-progress" },
      h(
        "div",
        { class: "row" },
        h("span", {}, `Schritt ${step + 1} von ${steps.length}`),
        h("span", {}, "Dein persönlicher Start"),
      ),
      h(
        "div",
        {
          class: "setup-bars",
          "aria-label": `Schritt ${step + 1} von ${steps.length}`,
        },
        steps.map((title, index) =>
          h("span", { class: index <= step ? "done" : "", title }),
        ),
      ),
    ),
    heading(
      steps[step],
      [
        "Ein guter Überblick beginnt mit deinen Konten.",
        "Etwa drei Monate pro Konto sind ein guter Anfang.",
        "Einmal zuordnen statt jede Buchung einzeln.",
        "Lokale Vorschläge. Du entscheidest, was stimmt.",
        "Aus der Vergangenheit wird ein Plan für deinen Monat.",
        "Dein Überblick steht. Den Rest machst du in deinem Tempo.",
      ][step],
      "Einrichtung",
    ),
  );
  if (step === 0)
    root.append(
      h(
        "div",
        { class: "setup-intro" },
        "Lege alle Konten an, die du gemeinsam planen möchtest. Das Monatsbudget gilt später über alle Konten hinweg.",
      ),
      accountList(ctx),
    );
  if (step === 1) root.append(importPanel(ctx));
  if (step === 2) root.append(await groups(ctx));
  if (step === 3)
    root.append(
      await history(ctx),
      h("div", { class: "section-head" }, h("h2", {}, "Umbuchungen erkennen")),
      await transferPanel(ctx),
    );
  if (step === 4) root.append(await startBudget(ctx));
  if (step === 5) root.append(await summary(ctx));
  root.append(
    h(
      "div",
      { class: "setup-nav" },
      step > 0
        ? action("Zurück", () => go(ctx, step - 1), { class: "outline" })
        : null,
      step < 5
        ? action("Weiter", () => go(ctx, step + 1), {
            class: "primary",
            disabled: step === 0 && !ctx.state.accounts.length,
          })
        : action(
            "Einrichtung abschließen",
            async () => {
              await ctx.api("/api/setup", "PUT", { step: 5, complete: true });
              await ctx.refresh();
              ctx.navigate("dashboard");
            },
            { class: "primary" },
          ),
    ),
  );
  return root;
}
async function groups(ctx) {
  const data = await ctx.api("/api/setup/suggestions");
  const available = data.groups.filter(
    (group) => !skippedGroups.has(group.key),
  );
  if (!available.length)
    return empty(
      "Die Gruppen sind durchgesehen.",
      skippedGroups.size
        ? `${skippedGroups.size} Gruppen wurden übersprungen. Diese Buchungen bleiben unverändert. Du kannst sie jederzeit in der Buchungsliste zuordnen.`
        : "Es sind keine unbestätigten Gruppen mehr vorhanden.",
      skippedGroups.size
        ? action(
            "Übersprungene Gruppen erneut ansehen",
            async () => {
              skippedGroups.clear();
              await persistSkipped(ctx);
              await ctx.render();
            },
            { class: "outline" },
          )
        : null,
    );
  const group = available[0];
  const category = select(
    [
      { value: "", label: "Kategorie auswählen" },
      ...categoryOptions(ctx.state),
    ],
    group.suggested_category_id || "",
    { required: true },
  );
  const match = input(group.match_text || group.name, { required: true });
  const preview = h("div");
  let previewedText = null;
  const confirm = h(
    "button",
    { type: "submit", class: "primary", disabled: true },
    "Gruppe & Regel bestätigen",
  );
  match.addEventListener("input", () => {
    previewedText = null;
    confirm.disabled = true;
    preview.replaceChildren();
  });
  const showPreview = async () => {
    const response = await ctx.api(
      `/api/setup/group-preview?${new URLSearchParams({ key: group.key, match_text: match.value })}`,
    );
    previewedText = match.value;
    preview.replaceChildren(
      h("div", { class: "divider" }),
      h("h3", {}, "Tatsächliche Treffer der Regel"),
      h(
        "p",
        { class: "small muted" },
        `„Gegenpartei enthält ${match.value}“ trifft ${response.total} Buchungen. Manuelle Zuordnungen werden nicht überschrieben. Diese Regel wird für zukünftige Imports gespeichert.`,
      ),
      h(
        "div",
        { class: "preview-list" },
        response.rows.map((transaction) =>
          transactionPreview(transaction, ctx.state),
        ),
      ),
    );
    confirm.disabled = false;
  };
  return h(
    "div",
    {},
    h(
      "div",
      { class: "setup-intro" },
      "Ähnliche Gegenparteien wurden lokal gruppiert. Ein Händlervorschlag ist nur eine Hilfe. Prüfe die tatsächlichen Suchtreffer, bevor du die Gruppe und ihre künftige Regel bestätigst.",
    ),
    h(
      "section",
      { class: "setup-group" },
      h(
        "p",
        { class: "group-counter" },
        `${available.length} Gruppen noch offen`,
      ),
      h("h2", { class: "group-name" }, group.name),
      h(
        "p",
        { class: "small muted" },
        `${group.count} Buchungen · ${money(group.total_cents)}`,
      ),
      form(
        async () => {
          if (previewedText !== match.value)
            throw new Error(
              "Bitte zuerst die tatsächlichen Regeltreffer prüfen.",
            );
          if (!category.value)
            throw new Error("Bitte eine Kategorie auswählen.");
          await ctx.api("/api/setup/group", "POST", {
            key: group.key,
            category_id: Number(category.value),
            match_text: match.value,
            confirm: true,
          });
          await ctx.refresh();
          await ctx.render();
          notify("Gruppe zugeordnet und Regel erstellt.");
        },
        h(
          "div",
          { class: "form-grid" },
          field("Kategorie für die Gruppe", category),
          field("Regel: Gegenpartei enthält", match),
          action("Regeltreffer prüfen", showPreview, { class: "outline" }),
        ),
        preview,
        h(
          "div",
          { class: "form-actions" },
          action(
            "Gruppe überspringen",
            async () => {
              skippedGroups.add(group.key);
              await persistSkipped(ctx);
              await ctx.render();
            },
            { class: "outline" },
          ),
          confirm,
        ),
      ),
    ),
  );
}
async function history(ctx) {
  const data = await ctx.api("/api/setup/suggestions");
  const root = h(
    "div",
    {},
    h(
      "div",
      { class: "setup-intro" },
      "Einkommen: mindestens 100 € von derselben Gegenpartei in zwei Monaten. Feste Kosten: ähnliche Ausgänge in zwei Monaten (höchstens 5 % vom Median). Nichts wird ohne deine Bestätigung gespeichert. Manuelle Zuordnungen bleiben erhalten.",
    ),
  );
  const incomes = data.history.income.filter(
    (item) => !skippedHistory.has(`income:${item.key}`),
  );
  const recurring = data.history.recurring.filter(
    (item) => !skippedHistory.has(`recurring:${item.key}`),
  );
  root.append(
    h("div", { class: "section-head" }, h("h2", {}, "Mögliche Einkommen")),
  );
  for (const suggestion of incomes) {
    const category = select(
      categoryOptions(ctx.state, (item) => item.is_income),
      undefined,
      { required: true },
    );
    root.append(
      h(
        "div",
        { class: "card" },
        h("h3", {}, suggestion.counterparty),
        h(
          "p",
          { class: "small muted" },
          `${suggestion.transaction_ids.length} passende Eingänge in mehreren Monaten`,
        ),
        form(
          async () => {
            if (!category.value)
              throw new Error("Bitte zuerst eine Einkommenskategorie anlegen.");
            await ctx.api("/api/setup/history", "POST", {
              key: suggestion.key,
              kind: "income",
              category_id: Number(category.value),
            });
            await ctx.refresh();
            await ctx.render();
            notify("Einkommen bestätigt.");
          },
          field("Einkommenskategorie", category),
          h(
            "div",
            { class: "form-actions" },
            action(
              "Vorschlag verwerfen",
              async () => {
                skippedHistory.add(`income:${suggestion.key}`);
                await persistSkipped(ctx);
                await ctx.render();
              },
              { class: "outline" },
            ),
            h(
              "button",
              { type: "submit", class: "primary" },
              "Einkommen bestätigen",
            ),
          ),
        ),
      ),
    );
  }
  if (!incomes.length)
    root.append(
      h(
        "p",
        { class: "small muted" },
        "Keine offenen Einkommensvorschläge. Du kannst jede Buchung auch manuell als Einkommen zuordnen.",
      ),
    );
  root.append(
    h("div", { class: "section-head" }, h("h2", {}, "Mögliche feste Kosten")),
  );
  for (const suggestion of recurring) {
    const name = input(suggestion.counterparty, { required: true });
    const counterparty = input(
      suggestion.counterparty_hint || suggestion.counterparty,
      { maxlength: 250 },
    );
    const amount = input(
      (suggestion.amount_cents / 100).toFixed(2).replace(".", ","),
      { inputmode: "decimal", required: true },
    );
    const firstDate = input(suggestion.first_due_date, {
      type: "date",
      required: true,
    });
    const category = select(categoryOptions(ctx.state, budgetable), undefined, {
      required: true,
    });
    root.append(
      h(
        "div",
        { class: "card" },
        h("h3", {}, suggestion.counterparty),
        h(
          "p",
          { class: "small muted" },
          "Vorschlag für einen monatlichen Posten. Betrag und erste Fälligkeit kannst du vor der Bestätigung ändern.",
        ),
        form(
          async () => {
            await ctx.api("/api/setup/history", "POST", {
              key: suggestion.key,
              kind: "recurring",
              category_id: Number(category.value),
              name: name.value,
              amount_cents: cents(amount.value),
              first_due_date: firstDate.value,
              counterparty_hint: counterparty.value,
            });
            await ctx.refresh();
            await ctx.render();
            notify("Monatlichen Posten bestätigt.");
          },
          h(
            "div",
            { class: "form-grid two-col" },
            field("Name des Postens", name),
            field("Betrag in Euro", amount),
            field("Erste Fälligkeit", firstDate),
            field("Budgetkategorie", category),
            field("Gegenpartei-Hinweis", counterparty),
          ),
          h(
            "div",
            { class: "form-actions" },
            action(
              "Vorschlag verwerfen",
              async () => {
                skippedHistory.add(`recurring:${suggestion.key}`);
                await persistSkipped(ctx);
                await ctx.render();
              },
              { class: "outline" },
            ),
            h(
              "button",
              { type: "submit", class: "primary" },
              "Monatlichen Posten bestätigen",
            ),
          ),
        ),
      ),
    );
  }
  if (!recurring.length)
    root.append(
      h(
        "p",
        { class: "small muted" },
        "Keine offenen Vorschläge für feste Kosten. Vierteljährliche und jährliche Posten legst du später unter „Feste Posten“ an.",
      ),
    );
  return root;
}
async function startBudget(ctx) {
  const root = h("div");
  const now = new Date();
  now.setDate(1);
  now.setMonth(now.getMonth() - 1);
  const previous = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const from = input(previous, {
    type: "month",
    required: true,
    max: previous,
  });
  const to = input(previous, { type: "month", required: true, max: previous });
  const target = input(ctx.month, { type: "month", required: true });
  const full = checkbox(
    "Ich bestätige: Für alle einbezogenen Konten ist die Historie im gesamten gewählten Zeitraum vollständig. Es sind ausschließlich abgeschlossene Kalendermonate.",
    false,
  );
  const preview = h("div");
  let requested = false;
  const renderPreview = async (amounts) => {
    requested = true;
    const fields = budgetFields(ctx, amounts);
    const replace = checkbox(
      "Vorhandene Budgets des Zielmonats ausdrücklich ersetzen",
      false,
    );
    preview.replaceChildren(
      h("h2", {}, "Dein anpassbarer Budgetplan"),
      h(
        "p",
        { class: "small muted" },
        "Der Durchschnitt berücksichtigt alle gewählten Monate – auch Monate ohne Ausgaben. Die Einkommensbasis wird unabhängig davon ausschließlich aus tatsächlichem Einkommen bzw. dem unmittelbaren Vormonat berechnet.",
      ),
      form(
        async () => {
          await ctx.api("/api/budgets", "POST", {
            month: target.value,
            amounts: fields.values(),
            replace: replace.control.checked,
          });
          ctx.month = target.value;
          notify("Start-Budget übernommen.");
        },
        field("Budget für Monat", target),
        h("div", { style: "margin-top:16px" }, fields.node),
        replace.node,
        h(
          "button",
          { type: "submit", class: "primary", style: "margin-top:15px" },
          "Budget übernehmen",
        ),
      ),
    );
  };
  const invalidate = () => {
    if (requested) {
      requested = false;
      preview.replaceChildren();
    }
  };
  from.addEventListener("change", invalidate);
  to.addEventListener("change", invalidate);
  full.control.addEventListener("change", invalidate);
  root.append(
    h(
      "div",
      { class: "setup-intro" },
      "Ein guter Startwert ist der Ausgabendurchschnitt vollständiger Monate. Wähle einen gemeinsamen Zeitraum für alle Konten. Teilmonate sind ausgeschlossen. Wenn noch kein vollständiger Monat vorliegt, plane dein Budget manuell.",
    ),
    h(
      "div",
      { class: "card" },
      form(
        async () => {
          if (!full.control.checked)
            throw new Error(
              "Bitte zuerst die vollständige Historie aller Konten bestätigen.",
            );
          if (from.value > to.value || to.value >= currentMonth())
            throw new Error(
              "Bitte einen gültigen Zeitraum abgeschlossener Kalendermonate wählen.",
            );
          const data = await ctx.api(
            `/api/setup/budget?${new URLSearchParams({ from: from.value, to: to.value })}`,
          );
          await renderPreview(data.amounts);
        },
        h(
          "div",
          { class: "form-grid two-col" },
          field("Erster vollständiger Monat", from),
          field("Letzter vollständiger Monat", to),
        ),
        h("div", { style: "margin:15px 0" }, full.node),
        h(
          "button",
          { type: "submit", class: "primary" },
          "Budgetvorschlag berechnen",
        ),
      ),
    ),
    action("Budget manuell planen", () => renderPreview([]), {
      class: "outline",
      style: "margin-bottom:24px",
    }),
    preview,
  );
  return root;
}
async function summary(ctx) {
  const data = await ctx.api("/api/setup/summary");
  return h(
    "div",
    {},
    h(
      "div",
      { class: "setup-intro" },
      "Gut gemacht! Deine bestätigten Einstellungen sind gespeichert. Du kannst den Assistenten jederzeit wieder aufrufen. Bereits bestätigte Aktionen werden nicht doppelt angelegt.",
    ),
    h(
      "div",
      { class: "summary-counts" },
      [
        ["transactions", "Buchungen"],
        ["categories", "Kategorien"],
        ["rules", "Regeln"],
        ["income", "Erkannte Einkommen"],
        ["recurring", "Feste Posten"],
        ["uncategorized", "Noch nicht kategorisiert"],
      ].map(([key, label]) =>
        h(
          "div",
          { class: "card" },
          h("strong", {}, data[key] ?? 0),
          h("span", {}, label),
        ),
      ),
    ),
    h(
      "p",
      { class: "small muted", style: "margin-top:20px" },
      "Nicht kategorisierte Buchungen bleiben sichtbar und fließen als Ausgaben in die Gesamtsumme ein. Du musst nicht alles heute erledigen.",
    ),
  );
}
