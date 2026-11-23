import { test, expect, type Page } from "@playwright/test";

const password = "NurLokal!Sicher2026";
const today = new Date();
const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const germanDate = `05.${month.slice(5)}.${month.slice(0, 4)}`;

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("vollständiger lokaler Hauptpfad mit wiederaufnehmbarer Einrichtung", async ({
  page,
}, info) => {
  const foreign: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4173/") &&
      !request.url().startsWith("data:")
    )
      foreign.push(request.url());
  });
  await page.goto("/");
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  if (await page.getByLabel("Passwort wiederholen").isVisible()) {
    await page.getByLabel("Passwort wiederholen").fill(password);
    await page.getByRole("button", { name: "Passwort festlegen" }).click();
  } else
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Hauptnavigation" }),
  ).toBeVisible();
  await noOverflow(page);

  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page
    .getByRole("button", { name: "Einrichtungs-Assistent", exact: true })
    .click();
  await page.getByRole("button", { name: "Von vorn beginnen" }).click();
  if (
    await page
      .getByRole("dialog", { name: "Assistent neu durchgehen?" })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Neu beginnen", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Konto hinzufügen", exact: true })
    .click();
  const account = `Giro ${info.project.name}`;
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill(account);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Speichern", exact: true })
    .click();
  await expect(page.getByText(account, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Historie importieren" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Historie importieren" }),
  ).toBeVisible();
  await page.getByLabel("Zielkonto").selectOption({ label: account });
  const csv = `Datum;Betrag;Gegenpartei;Verwendungszweck\n${germanDate};-42,50;MARKT ${info.project.name};Wocheneinkauf\n${germanDate};2500,00;ARBEITGEBER ${info.project.name};Gehalt\n`;
  await page.getByLabel("CSV-Datei").setInputFiles({
    name: "umsatz.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page
    .getByRole("button", { name: "Vorschau anzeigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Import-Vorschau" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import bestätigen", exact: true })
    .click();
  await expect(
    page.getByText("2 neu importiert", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Vorschau anzeigen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import bestätigen", exact: true })
    .click();
  await expect(
    page.getByText("0 neu importiert", { exact: false }),
  ).toBeVisible();
  await noOverflow(page);

  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Gruppen zuordnen" }),
  ).toBeVisible();
  await page
    .getByLabel("Kategorie für die Gruppe")
    .selectOption({ label: "Einkommen" });
  await page.getByRole("button", { name: "Regeltreffer prüfen" }).click();
  await expect(
    page.getByRole("heading", { name: "Tatsächliche Treffer der Regel" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Gruppe & Regel bestätigen" }).click();
  await expect(
    page.getByRole("button", { name: "Regeltreffer prüfen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Gruppe überspringen" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Gruppen zuordnen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Einkommen & feste Kosten" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Budget manuell planen" }).click();
  await page.getByLabel("Budget Lebensmittel").fill("300,00");
  await page
    .getByLabel("Vorhandene Budgets des Zielmonats ausdrücklich ersetzen")
    .check();
  await page
    .getByRole("button", { name: "Budget übernehmen", exact: true })
    .click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Alles im Überblick" }),
  ).toBeVisible();
  const dashboardResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/dashboard?") &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Einrichtung abschließen" }).click();
  await (await dashboardResponse).finished();
  const responseFinished = Date.now();
  await expect(
    page.getByRole("heading", { name: "Dein Monat. Dein Plan." }),
  ).toBeVisible();
  expect(Date.now() - responseFinished).toBeLessThan(1000);
  await noOverflow(page);

  await page.getByRole("button", { name: "Buchungen", exact: true }).click();
  await page
    .getByLabel("Buchungen durchsuchen")
    .fill(`MARKT ${info.project.name}`);
  const booking = page.getByRole("button", {
    name: new RegExp(`MARKT ${info.project.name}.*Kategorie ändern`),
  });
  await expect(booking).toBeVisible();
  await expect(booking).toContainText("-42,50");
  await expect(booking).toContainText(germanDate);
  const started = Date.now();
  await booking.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Lebensmittel", exact: true })
    .click();
  await expect(booking).toContainText("Lebensmittel");
  expect(Date.now() - started).toBeLessThan(5000);
  await expect(
    page.getByRole("button", { name: "Regel daraus erstellen" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "Regel daraus erstellen" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Speichern", exact: true })
    .click();
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("button", { name: "Regeln", exact: true }).click();
  await expect(
    page.getByText(`MARKT ${info.project.name}`, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Bestehende Buchungen prüfen" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Regelvorschau" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Abbrechen", exact: true })
    .click();

  const small = await page
    .locator("button:visible,input:visible,select:visible")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width < 44 || box.height < 44;
        })
        .map((node) => node.textContent || node.getAttribute("aria-label")),
    );
  expect(small).toEqual([]);
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(
    page.getByRole("button", { name: "Anmelden", exact: true }),
  ).toBeVisible();
  expect(foreign).toEqual([]);
});

test("wiederkehrende Zahlungsvorschläge zeigen Buchungsdaten statt DOM-Objekttext", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  if (await page.getByLabel("Passwort wiederholen").isVisible()) {
    await page.getByLabel("Passwort wiederholen").fill(password);
    await page.getByRole("button", { name: "Passwort festlegen" }).click();
  } else {
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  }
  await page.getByRole("navigation", { name: "Hauptnavigation" }).waitFor();
  const auth = await page.evaluate(async () =>
    (await fetch("/api/auth")).json(),
  );
  const state = await page.evaluate(
    async ({ csrf }) =>
      (await fetch("/api/state", { headers: { "x-csrf-token": csrf } })).json(),
    { csrf: auth.csrf },
  );
  const account = await page.evaluate(
    async ({ csrf }) => {
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ name: "Vorschau Giro", type: "Giro" }),
      });
      return response.json();
    },
    { csrf: auth.csrf },
  );
  const categoryId = state.categories.find(
    (category: { name: string }) => category.name === "Wohnen",
  ).id;
  await page.evaluate(
    async ({ csrf, accountId, categoryId, month, csv }) => {
      const call = (url: string, body: object) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify(body),
        });
      await call("/api/recurring-items", {
        name: "Vorschau Miete",
        amount_cents: 4250,
        interval: "monthly",
        first_due_date: `${month}-05`,
        category_id: categoryId,
        counterparty_hint: "Vermieter Vorschau",
      });
      await call("/api/import/confirm", {
        account_id: accountId,
        filename: "miete.csv",
        content_base64: btoa(csv),
        config: {
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
        },
      });
    },
    {
      csrf: auth.csrf,
      accountId: account.id,
      categoryId,
      month,
      csv: `Datum;Betrag;Gegenpartei;Verwendungszweck\n05.${month.slice(5)}.${month.slice(0, 4)};-42,50;Vermieter Vorschau;Miete\n`,
    },
  );
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("button", { name: "Feste Posten", exact: true }).click();
  await expect(
    page.getByText("Mögliche Zahlung gefunden:", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("[object HTMLDivElement]", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Vermieter Vorschau", { exact: true }),
  ).toBeVisible();
});
