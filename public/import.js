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
export function importPanel(ctx) {
  const panel = h("div");
  if (!ctx.state.accounts.length)
    return empty(
      "Zuerst ein Konto anlegen",
      "Jede Buchung braucht ein Zuhause. Lege ein Konto an und kehre dann zum Import zurück.",
      action("Konten verwalten", () => ctx.navigate("accounts"), {
        class: "primary",
      }),
    );
  let fileData = null;
  let filename = "";
  let payload = null;
  const saved = () =>
    ctx.state.profiles.find(
      (profile) => Number(profile.account_id) === Number(account.value),
    );
  const account = select(
    ctx.state.accounts.map((item) => ({ value: item.id, label: item.name })),
    ctx.state.accounts[0].id,
    { required: true },
  );
  const file = input("", {
    type: "file",
    accept: ".csv,text/csv,text/plain",
    required: true,
  });
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
  const config = () => ({
    delimiter: delimiter.value,
    encoding: encoding.value,
    date_format: dateFormat.value,
    decimal_format: decimalFormat.value,
    column_mapping: Object.fromEntries(
      Object.entries(columns).map(([key, node]) => [key, node.value]),
    ),
  });
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
    invalidate();
  };
  const invalidate = () => {
    payload = null;
    previewContainer.replaceChildren();
  };
  account.addEventListener("change", loadProfile);
  file.addEventListener("change", () => {
    fileData = null;
    filename = "";
    invalidate();
    result.replaceChildren();
  });
  for (const control of [
    delimiter,
    encoding,
    dateFormat,
    decimalFormat,
    ...Object.values(columns),
  ])
    control.addEventListener("input", invalidate);
  loadProfile();
  const controls = h(
    "div",
    { class: "card" },
    h("h2", {}, "Datei & Konto"),
    h(
      "div",
      { class: "form-grid" },
      field("Zielkonto", account),
      field(
        "CSV-Datei",
        file,
        "Die Datei wird ausschließlich auf deinem eigenen Server verarbeitet.",
      ),
    ),
    profileStatus,
  );
  const settings = h(
    "div",
    { class: "card" },
    h("h2", {}, "Import-Profil"),
    h(
      "div",
      { class: "form-grid two-col" },
      field("Trennzeichen", delimiter),
      field("Zeichenkodierung", encoding),
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
      if (!file.files?.[0])
        throw new Error("Bitte zuerst eine CSV-Datei auswählen.");
      if (!fileData) {
        const chosen = file.files[0];
        fileData = base64(await chosen.arrayBuffer());
        filename = chosen.name;
      }
      const request = {
        account_id: Number(account.value),
        filename,
        content_base64: fileData,
        config: config(),
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
              transactionPreview(
                { ...row, account_id: Number(account.value) },
                ctx.state,
              ),
            ),
        ),
        h(
          "p",
          { class: "small muted" },
          `${data.new_count ?? "–"} neu · ${data.skipped_count ?? "–"} bereits vorhanden · ${data.uncategorized_count ?? "–"} nicht kategorisiert`,
        ),
        action(
          "Import bestätigen",
          async () => {
            if (!payload)
              throw new Error(
                "Die Einstellungen wurden geändert. Bitte die Vorschau erneut öffnen.",
              );
            const response = await ctx.api(
              "/api/import/confirm",
              "POST",
              payload,
            );
            await ctx.refresh();
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
                    `${response.skipped_count} übersprungen (Duplikate) · ${response.uncategorized_count} nicht kategorisiert`,
                  ),
                ),
              ),
            );
            previewContainer.replaceChildren();
            payload = null;
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
        "Konto, Datum, Betrag, Gegenpartei und Verwendungszweck werden verglichen. Mehrere identische Buchungen in einer Datei bleiben erhalten. Wenn zwei identische reale Buchungen nie gemeinsam in einer Datei vorkommen, sind sie anhand dieser Daten nicht unterscheidbar. Importiere daher möglichst vollständige, überlappende Zeiträume.",
      ),
    ),
  );
  return panel;
}
export async function importPage(ctx) {
  return h(
    "div",
    {},
    heading(
      "Deine Zahlen kommen an.",
      "CSV auswählen, Vorschau prüfen und bewusst importieren.",
      "CSV-Import",
    ),
    importPanel(ctx),
  );
}
