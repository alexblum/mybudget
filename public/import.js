import {
  h,
  action,
  input,
  select,
  field,
  form,
  heading,
  empty,
  notify,
  transactionPreview,
  money,
  date,
} from "./ui.js";

const defaultConfig = {
  delimiter: ";",
  encoding: "utf-8",
  date_format: "DD.MM.YYYY",
  decimal_format: ",",
  column_mapping: {
    booking_date: "Datum",
    amount_cents: "Betrag",
    counterparty: "Gegenpartei",
    purpose: "Verwendungszweck",
  },
};
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 16384)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  return btoa(parts.join(""));
}
const paypalKinds = {
  payment: "Zahlung",
  refund: "Rückerstattung",
  bank_funding: "Bankfinanzierung",
  bank_withdrawal: "Auszahlung aufs Bankkonto",
  credit_funding: "Kreditfinanzierung",
  credit_repayment: "Kreditrückzahlung",
};
function paypalDetail(row) {
  return h(
    "div",
    { class: "preview-row" },
    h(
      "div",
      { class: "row" },
      h("strong", {}, row.counterparty || "Ohne Händlerangabe"),
      h("strong", {}, money(row.amount_cents)),
    ),
    h(
      "div",
      { class: "small muted" },
      `${date(row.booking_date)} · ${paypalKinds[row.paypal_kind] || row.paypal_kind || "PayPal-Detail"}`,
    ),
    row.purpose ? h("p", {}, row.purpose) : null,
    row.external_id
      ? h(
          "div",
          { class: "small muted", style: "overflow-wrap:anywhere" },
          `Transaktionscode: ${row.external_id}`,
        )
      : null,
    row.related_external_id
      ? h(
          "div",
          { class: "small muted", style: "overflow-wrap:anywhere" },
          `Zugehöriger Transaktionscode: ${row.related_external_id}`,
        )
      : null,
  );
}

export function importPanel(ctx, onImported = async () => {}) {
  const panel = h("div");
  let fileData = null;
  let filename = "";
  let payload = null;
  const saved = () =>
    ctx.state.profiles.find(
      (profile) => Number(profile.account_id) === Number(account.value),
    );
  const account = select(
    ctx.state.accounts.length
      ? ctx.state.accounts.map((item) => ({ value: item.id, label: item.name }))
      : [{ value: "", label: "Noch kein Konto angelegt" }],
    ctx.state.accounts[0]?.id ?? "",
    { required: true },
  );
  const file = input("", {
    type: "file",
    accept: ".csv,text/csv,text/plain",
    required: true,
  });
  const parser = select(
    [
      { value: "generic", label: "Konfigurierbare CSV" },
      { value: "ing-de", label: "ING Deutschland Umsatzanzeige" },
      { value: "sparkasse-camt52", label: "Sparkasse CAMT52 v8" },
      { value: "paypal-de", label: "PayPal Deutschland Aktivitäten" },
    ],
    ctx.state.accounts.length ? "generic" : "paypal-de",
  );
  const delimiter = select(
    [
      { value: ";", label: "Semikolon (;)" },
      { value: ",", label: "Komma (,)" },
      { value: "\t", label: "Tabulator" },
      { value: "|", label: "Senkrechter Strich (|)" },
    ],
    ";",
  );
  const encoding = select(
    [
      { value: "utf-8", label: "UTF-8" },
      { value: "windows-1252", label: "Windows-1252 / ANSI" },
    ],
    "utf-8",
  );
  const dateFormat = select(
    ["DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YYYY"].map((value) => ({
      value,
      label: value,
    })),
    "DD.MM.YYYY",
  );
  const decimalFormat = select(
    [
      { value: ",", label: "Komma · 1.234,56" },
      { value: ".", label: "Punkt · 1,234.56" },
    ],
    ",",
  );
  const columns = {
    booking_date: input("Datum", { required: true }),
    amount_cents: input("Betrag", { required: true }),
    counterparty: input("Gegenpartei", { required: true }),
    purpose: input("Verwendungszweck", { required: true }),
  };
  const previewContainer = h("div");
  const result = h("div", { role: "status" });
  const profileStatus = h("p", { class: "small muted" });
  const paypalInstructions = h("div");
  const accountField = field("Zielkonto", account);
  const accountNotice = h("div");
  const config = () => ({
    delimiter: delimiter.value,
    encoding: encoding.value,
    date_format: dateFormat.value,
    decimal_format: decimalFormat.value,
    column_mapping: Object.fromEntries(
      Object.entries(columns).map(([key, node]) => [key, node.value]),
    ),
  });
  const applyParserDefaults = (useDefaults = true) => {
    const paypal = parser.value === "paypal-de";
    accountField.style.display = paypal ? "none" : "";
    account.disabled = paypal || !ctx.state.accounts.length;
    account.required = !paypal;
    settings.style.display = paypal ? "none" : "";
    profileStatus.hidden = paypal || !ctx.state.accounts.length;
    for (const control of [
      delimiter,
      dateFormat,
      decimalFormat,
      ...Object.values(columns),
    ])
      control.disabled = paypal;
    accountNotice.replaceChildren();
    if (!paypal && !ctx.state.accounts.length)
      accountNotice.append(
        empty(
          "Für Bankbuchungen zuerst ein Konto anlegen",
          "PayPal-Details kannst du schon ohne Konto importieren. Für Bankbuchungen brauchst du ein Zielkonto.",
          action("Konten verwalten", () => ctx.navigate("accounts"), {
            class: "outline",
          }),
        ),
      );
    paypalInstructions.replaceChildren();
    if (paypal)
      paypalInstructions.append(
        h(
          "div",
          { class: "notice" },
          h(
            "div",
            {},
            h("strong", {}, "PayPal ergänzt deine Bankbuchungen"),
            h(
              "p",
              {},
              "Die Bankbuchung bleibt deine Ausgabe oder Einnahme und behält ihre Kategorie. PayPal liefert Händler, Verwendungszweck und Transaktionscodes – ohne eigenes Konto und ohne zusätzliche Budgetbuchung.",
            ),
            h(
              "p",
              {},
              "Eindeutige Treffer werden automatisch verknüpft, unabhängig von der Importreihenfolge. Mehrdeutige oder fehlende Treffer prüfst du unten. Nicht zugeordnete Zahlungen, auch Kreditkäufe, bleiben sichtbar und zählen nicht ins Budget.",
            ),
          ),
        ),
      );
    if (
      useDefaults &&
      ["ing-de", "sparkasse-camt52", "paypal-de"].includes(parser.value)
    ) {
      delimiter.value = paypal ? "," : ";";
      encoding.value = parser.value === "ing-de" ? "windows-1252" : "utf-8";
      dateFormat.value = "DD.MM.YYYY";
      decimalFormat.value = ",";
    }
    invalidate();
  };
  const loadProfile = () => {
    const profile = saved();
    const conf = profile?.config || defaultConfig;
    delimiter.value = conf.delimiter;
    encoding.value = conf.encoding;
    dateFormat.value = conf.date_format;
    decimalFormat.value = conf.decimal_format;
    for (const [key, control] of Object.entries(columns))
      control.value = conf.column_mapping[key];
    profileStatus.textContent = profile
      ? "Gespeichertes Import-Profil dieses Kontos geladen."
      : "Noch kein Profil. Die Einstellungen werden erst mit dem bestätigten Import gespeichert.";
    applyParserDefaults(!profile);
    invalidate();
  };
  const invalidate = () => {
    payload = null;
    previewContainer.replaceChildren();
  };
  account.addEventListener("change", loadProfile);
  parser.addEventListener("change", applyParserDefaults);
  file.addEventListener("change", () => {
    fileData = null;
    filename = "";
    invalidate();
    result.replaceChildren();
  });
  for (const control of [
    parser,
    delimiter,
    encoding,
    dateFormat,
    decimalFormat,
    ...Object.values(columns),
  ])
    control.addEventListener("input", invalidate);
  const controls = h(
    "div",
    { class: "card" },
    h("h2", {}, "Datei & Format"),
    h(
      "div",
      { class: "form-grid" },
      accountField,
      field(
        "CSV-Format",
        parser,
        "Für den ING-Export werden Metadaten vor der Buchungstabelle automatisch übersprungen.",
      ),
      field(
        "CSV-Datei",
        file,
        "Die Datei wird ausschließlich auf deinem eigenen Server verarbeitet.",
      ),
      field("Zeichenkodierung", encoding),
    ),
    profileStatus,
    accountNotice,
    paypalInstructions,
  );
  const settings = h(
    "div",
    { class: "card" },
    h("h2", {}, "Import-Profil"),
    h(
      "div",
      { class: "form-grid two-col" },
      field("Trennzeichen", delimiter),
      field("Datumsformat", dateFormat),
      field("Dezimalformat", decimalFormat),
    ),
    h("div", { class: "divider" }),
    h("h3", {}, "Spaltenzuordnung"),
    h(
      "p",
      { class: "small muted" },
      "Trage die Spaltennamen genau so ein, wie sie in der ersten Zeile deiner CSV stehen.",
    ),
    h(
      "div",
      { class: "form-grid two-col" },
      field("Spalte Buchungsdatum", columns.booking_date),
      field("Spalte Betrag", columns.amount_cents),
      field("Spalte Gegenpartei", columns.counterparty),
      field("Spalte Verwendungszweck", columns.purpose),
    ),
    h(
      "div",
      { class: "form-actions" },
      action(
        "Profil speichern",
        async () => {
          await ctx.api(`/api/profiles/${account.value}`, "PUT", {
            config: config(),
          });
          await ctx.refresh();
          profileStatus.textContent = "Import-Profil gespeichert.";
          notify("Profil gespeichert.");
        },
        { class: "outline" },
      ),
    ),
  );
  settings.append(
    h(
      "div",
      { class: "form-actions" },
      action(
        "Profil zurücksetzen",
        async () => {
          await ctx.api(`/api/profiles/${account.value}`, "DELETE");
          await ctx.refresh();
          loadProfile();
          notify("Gespeichertes Profil entfernt. Standardwerte geladen.");
        },
        { class: "subtle" },
      ),
    ),
  );
  const importer = form(
    async () => {
      if (parser.value !== "paypal-de" && !account.value)
        throw new Error("Bitte zuerst ein Konto für die Bankbuchungen anlegen.");
      if (!file.files?.[0])
        throw new Error("Bitte zuerst eine CSV-Datei auswählen.");
      if (!fileData) {
        const chosen = file.files[0];
        fileData = base64(await chosen.arrayBuffer());
        filename = chosen.name;
      }
      const request = {
        ...(parser.value === "paypal-de"
          ? { config: { encoding: encoding.value } }
          : { account_id: Number(account.value), config: config() }),
        filename,
        content_base64: fileData,
        parser_id: parser.value,
      };
      const data = await ctx.api("/api/import/preview", "POST", request);
      payload = request;
      const preview = h(
        "section",
        { class: "card" },
        h("h2", {}, "Import-Vorschau"),
        h(
          "p",
          { class: "small muted" },
          "Prüfe Datum, Vorzeichen und Spalten. Es wurde noch nichts importiert.",
        ),
        h(
          "div",
          { class: "preview-list" },
          (data.rows || [])
            .slice(0, 10)
            .map((row) =>
              parser.value === "paypal-de"
                ? paypalDetail(row)
                : transactionPreview(
                    { ...row, account_id: Number(account.value) },
                    ctx.state,
                  ),
            ),
        ),
        h(
          "p",
          { class: "small muted" },
          parser.value === "paypal-de"
            ? `${data.new_count ?? "–"} neue PayPal-Details · ${data.skipped_count ?? "–"} bereits vorhanden · keine zusätzlichen Budgetbuchungen`
            : `${data.new_count ?? "–"} neu · ${data.skipped_count ?? "–"} bereits vorhanden · ${data.uncategorized_count ?? "–"} nicht kategorisiert`,
        ),
        action(
          "Import bestätigen",
          async () => {
            if (!payload)
              throw new Error(
                "Die Einstellungen wurden geändert. Bitte die Vorschau erneut öffnen.",
              );
            const confirmed = payload;
            const response = await ctx.api(
              "/api/import/confirm",
              "POST",
              confirmed,
            );
            await ctx.refresh();
            await onImported();
            result.replaceChildren(
              h(
                "div",
                { class: "notice success" },
                h(
                  "div",
                  {},
                  h("strong", {}, `${response.new_count} neu importiert`),
                  h(
                    "p",
                    {},
                    confirmed.parser_id === "paypal-de"
                      ? `${response.skipped_count} übersprungen (Duplikate) · ${response.linked_count ?? 0} verknüpft · ${response.unmatched_count ?? 0} nicht zugeordnet · keine zusätzlichen Budgetbuchungen`
                      : `${response.skipped_count} übersprungen (Duplikate) · ${response.uncategorized_count} nicht kategorisiert`,
                  ),
                ),
              ),
            );
            previewContainer.replaceChildren();
            payload = null;
            if (parser.value !== "paypal-de")
              profileStatus.textContent =
                "Import-Profil dieses Kontos gespeichert.";
            notify("Import abgeschlossen.");
          },
          { class: "primary" },
        ),
      );
      previewContainer.replaceChildren(preview);
      preview.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    controls,
    settings,
    h("button", { type: "submit", class: "primary" }, "Vorschau anzeigen"),
  );
  loadProfile();
  panel.append(
    h(
      "div",
      { class: "notice" },
      h(
        "p",
        {},
        "Überlappende Zeiträume sind willkommen: Bereits vorhandene Buchungen werden gezählt und übersprungen. Positive Beträge sind Eingänge, negative Beträge Ausgaben.",
      ),
    ),
    result,
    importer,
    h("div", { style: "margin-top:20px" }, previewContainer),
    h(
      "details",
      {},
      h("summary", {}, "Wie werden Duplikate erkannt?"),
      h(
        "p",
        {},
        "Bankbuchungen werden anhand von Konto, Datum, Betrag, Gegenpartei und Verwendungszweck verglichen. Mehrere identische Buchungen in einer Datei bleiben erhalten. PayPal-Details werden anhand ihrer Transaktionscodes erkannt. Importiere möglichst vollständige, überlappende Zeiträume.",
      ),
    ),
  );
  return panel;
}
function paypalReview(ctx) {
  const list = h("div", { class: "transaction-list" });
  const count = h("small", { role: "status" });
  const statuses = {
    linked: "PayPal verknüpft",
    unmatched: "Nicht zugeordnet",
    ambiguous: "Mehrere mögliche Bankbuchungen – bitte prüfen",
    credit_unmatched: "Kreditkauf · nicht zugeordnet",
    unlinked: "Verknüpfung aufgehoben · manuell zuordnen",
  };
  const load = async () => {
    const data = await ctx.api("/api/paypal");
    const unmatched = data.rows.filter((row) => !row.transaction_id).length;
    count.textContent = `${data.rows.length} PayPal-Details · ${unmatched} nicht zugeordnet`;
    list.replaceChildren(
      ...(data.rows.length
        ? data.rows.map((row) => {
            const linked = row.transaction_id !== null;
            const card = h(
              "section",
              { class: "card" },
              paypalDetail(row),
              h(
                "p",
                { class: `tag ${linked ? "paid" : "warning"}` },
                statuses[row.status] || row.status,
              ),
            );
            if (linked) {
              const bank = row.candidates.find(
                (candidate) => candidate.id === row.transaction_id,
              );
              card.append(
                h(
                  "p",
                  { class: "small muted" },
                  bank
                    ? `Bankbuchung: ${date(bank.booking_date)} · ${bank.counterparty || "Ohne Gegenpartei"} · ${money(bank.amount_cents)}`
                    : `Verknüpft mit Bankbuchung #${row.transaction_id}. Die Bankkategorie bleibt unverändert.`,
                ),
                action(
                  "Verknüpfung aufheben",
                  async () => {
                    await ctx.api(`/api/paypal/${row.id}/link`, "DELETE");
                    await ctx.refresh();
                    await load();
                    notify("PayPal-Verknüpfung aufgehoben. Die Bankbuchung bleibt unverändert.");
                  },
                  { class: "outline" },
                ),
              );
            } else {
              card.append(
                h(
                  "p",
                  { class: "small muted" },
                  row.status === "credit_unmatched"
                    ? "Dieser Kreditkauf ist noch keiner Bankbuchung zugeordnet und zählt nicht ins Budget. Kreditfinanzierung und Rückzahlungen werden nicht als zusätzliche Käufe gebucht."
                    : "Dieses PayPal-Detail zählt nicht ins Budget. Nur die Bankbuchung wird dort berücksichtigt.",
                ),
              );
              if (row.candidates.length) {
                const candidate = select(
                  [
                    { value: "", label: "Bankbuchung auswählen" },
                    ...row.candidates.map((item) => ({
                      value: item.id,
                      label: `${date(item.booking_date)} · ${item.counterparty || "Ohne Gegenpartei"} · ${money(item.amount_cents)}${item.purpose ? ` · ${item.purpose}` : ""}`,
                    })),
                  ],
                  "",
                  { required: true },
                );
                card.append(
                  form(
                    async () => {
                      if (!candidate.value)
                        throw new Error("Bitte eine Bankbuchung auswählen.");
                      await ctx.api(`/api/paypal/${row.id}/link`, "POST", {
                        transaction_id: Number(candidate.value),
                      });
                      await ctx.refresh();
                      await load();
                      notify("PayPal verknüpft. Die Bankkategorie bleibt unverändert.");
                    },
                    field("Passende Bankbuchung", candidate),
                    h(
                      "div",
                      { class: "form-actions" },
                      h("button", { type: "submit", class: "primary" }, "Verknüpfen"),
                    ),
                  ),
                );
              } else {
                card.append(
                  h(
                    "p",
                    { class: "small muted" },
                    "Noch keine passende Bankbuchung gefunden. Importiere bei Bedarf die Bankumsätze des passenden Zeitraums. Eindeutige neue Treffer werden automatisch verknüpft; aufgehobene Verknüpfungen bleiben zur manuellen Prüfung offen.",
                  ),
                );
              }
            }
            return card;
          })
        : [
            empty(
              "Noch keine PayPal-Details importiert.",
              "Wähle oben das PayPal-Format und importiere deinen Aktivitätenexport. Ein eigenes PayPal-Konto ist nicht nötig.",
            ),
          ]),
    );
  };
  return {
    load,
    node: h(
      "section",
      { style: "margin-top:28px" },
      h(
        "div",
        { class: "section-head" },
        h("h2", {}, "PayPal prüfen & verknüpfen"),
        count,
      ),
      h(
        "p",
        { class: "small muted" },
        "Eindeutige Zuordnungen entstehen automatisch. Prüfe offene oder mehrdeutige Details und wähle die richtige Bankbuchung. Eine falsche Verknüpfung kannst du aufheben und anschließend korrigieren; Betrag und Kategorie der Bankbuchung bleiben gleich.",
      ),
      action("PayPal-Details aktualisieren", load, { class: "subtle" }),
      list,
    ),
  };
}

export async function importPage(ctx) {
  const review = paypalReview(ctx);
  await review.load();
  return h(
    "div",
    {},
    heading(
      "Deine Zahlen kommen an.",
      "CSV auswählen, Vorschau prüfen und bewusst importieren.",
      "CSV-Import",
    ),
    importPanel(ctx, review.load),
    review.node,
  );
}
