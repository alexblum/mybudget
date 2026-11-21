import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
test("private data requires login and password setup can only finish once", async () => {
  const app = await createApp({ dbPath: ":memory:" });
  try {
    assert.equal((await app.inject("/api/state")).statusCode, 401);
    assert.equal((await app.inject("/%61pi/state")).statusCode, 401);
    const authResponse = await app.inject("/api/auth");
    const auth = authResponse.json();
    const headers = {
      "x-csrf-token": auth.csrf,
      cookie: String(authResponse.headers["set-cookie"]).split(";")[0],
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: "/api/auth/setup",
          headers,
          payload: { password: "ein-sicheres-passwort" },
        }),
      ),
    );
    assert.deepEqual(
      results.map((result) => result.statusCode).sort(),
      [200, 409],
    );
    const setup = results.find((result) => result.statusCode === 200)!;
    const loggedHeaders = {
      "x-csrf-token": setup.json().csrf,
      cookie: String(setup.headers["set-cookie"]).split(";")[0],
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/setup",
          headers: loggedHeaders,
          payload: { password: "anderes-passwort" },
        })
      ).statusCode,
      409,
    );
  } finally {
    await app.close();
  }
});

test("overlapping CSV imports preserve occurrence counts and manual assignments", async () => {
  const app = await createApp({ dbPath: ":memory:" });
  try {
    const auth = await app.inject("/api/auth");
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: {
        cookie: String(auth.headers["set-cookie"]).split(";")[0],
        "x-csrf-token": auth.json().csrf,
      },
      payload: { password: "ein-sicheres-passwort" },
    });
    const headers = {
      cookie: String(setup.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": setup.json().csrf,
    };
    const call = async (url: string, payload: unknown) => {
      const r = await app.inject({
        method: "POST",
        url,
        headers,
        payload: payload as object,
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    const account = await call("/api/accounts", { name: "Giro", type: "Giro" });
    const config = {
      delimiter: ";",
      encoding: "utf-8",
      date_format: "DD.MM.YYYY",
      decimal_format: ",",
      column_mapping: {
        booking_date: "Datum",
        amount_cents: "Betrag",
        counterparty: "Partner",
        purpose: "Zweck",
      },
    };
    const input = (n: number) => ({
      account_id: account.id,
      filename: "demo.csv",
      config,
      content_base64: Buffer.from(
        "Datum;Betrag;Partner;Zweck\n" +
          Array(n).fill("01.11.2026;-12,34;REWE;Einkauf").join("\n"),
      ).toString("base64"),
    });
    assert.equal((await call("/api/import/confirm", input(2))).new_count, 2);
    assert.equal((await call("/api/import/confirm", input(3))).new_count, 1);
    assert.equal((await call("/api/import/confirm", input(3))).new_count, 0);
    const state = (await app.inject({ url: "/api/state", headers })).json();
    const food = state.categories.find(
      (c: { name: string }) => c.name === "Lebensmittel",
    ).id;
    const other = state.categories.find(
      (c: { name: string }) => c.name === "Sonstiges",
    ).id;
    const list = (
      await app.inject({ url: "/api/transactions?month=2026-11", headers })
    ).json();
    assert.equal(list.total, 3);
    await call(`/api/transactions/${list.rows[0].id}/category`, {
      category_id: food,
    });
    await call("/api/rules", {
      match_text: "REWE",
      match_field: "counterparty",
      category_id: other,
      priority: 0,
    });
    const preview = await call("/api/rules/apply", { confirm: false });
    assert.equal(preview.changes.length, 2);
    await call("/api/rules/apply", { confirm: true });
    const after = (
      await app.inject({ url: "/api/transactions?month=2026-11", headers })
    ).json();
    assert.equal(
      after.rows.find((r: { id: number }) => r.id === list.rows[0].id)
        .category_id,
      food,
    );
    const invalid = {
      ...input(1),
      content_base64: Buffer.from(
        "Datum;Betrag;Partner;Zweck\n01.11.2026;-1,00;Neu;ok\n31.02.2026;-2,00;Neu;kaputt",
      ).toString("base64"),
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/import/confirm",
          headers,
          payload: invalid,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: "/api/transactions", headers })).json().total,
      3,
    );
  } finally {
    await app.close();
  }
});

test("sessions expire, logout invalidates them, and login failures are bounded", async () => {
  let now = 1_000_000;
  const app = await createApp({ dbPath: ":memory:", now: () => now });
  try {
    const auth = await app.inject("/api/auth");
    const anonymous = {
      cookie: String(auth.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": auth.json().csrf,
    };
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: anonymous,
      payload: { password: "ein-sicheres-passwort" },
    });
    const logged = {
      cookie: String(setup.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": setup.json().csrf,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/accounts",
          headers: { cookie: logged.cookie },
          payload: { name: "X", type: "Giro" },
        })
      ).statusCode,
      403,
    );
    now += 30 * 60_000;
    assert.equal(
      (await app.inject({ url: "/api/state", headers: logged })).statusCode,
      401,
    );
    const fresh = await app.inject("/api/auth");
    const headers = {
      cookie: String(fresh.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": fresh.json().csrf,
    };
    for (let n = 0; n < 5; n++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/login",
            headers,
            payload: { password: "falsches-passwort" },
          })
        ).statusCode,
        401,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers,
          payload: { password: "ein-sicheres-passwort" },
        })
      ).statusCode,
      429,
    );
    now += 15 * 60_000;
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { password: "ein-sicheres-passwort" },
    });
    assert.equal(login.statusCode, 200);
    const session = {
      cookie: String(login.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": login.json().csrf,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: session,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/api/state", headers: session })).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});

test("confirmed recurring payments and transfers cannot be consumed twice", async () => {
  const app = await createApp({ dbPath: ":memory:" });
  try {
    const auth = await app.inject("/api/auth");
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: {
        cookie: String(auth.headers["set-cookie"]).split(";")[0],
        "x-csrf-token": auth.json().csrf,
      },
      payload: { password: "ein-sicheres-passwort" },
    });
    const headers = {
      cookie: String(setup.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": setup.json().csrf,
    };
    const post = async (url: string, payload: object) => {
      const r = await app.inject({ method: "POST", url, headers, payload });
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    const a = await post("/api/accounts", { name: "Giro", type: "Giro" }),
      b = await post("/api/accounts", { name: "Tagesgeld", type: "Tagesgeld" });
    const state = (await app.inject({ url: "/api/state", headers })).json();
    const home = state.categories.find(
        (c: { name: string }) => c.name === "Wohnen",
      ).id,
      transfer = state.categories.find(
        (c: { name: string }) => c.name === "Umbuchung",
      ).id;
    const config = {
      delimiter: ";",
      encoding: "utf-8",
      date_format: "YYYY-MM-DD",
      decimal_format: ".",
      column_mapping: {
        booking_date: "Date",
        amount_cents: "Amount",
        counterparty: "Party",
        purpose: "Purpose",
      },
    };
    for (const [account_id, rows] of [
      [
        a.id,
        "2026-11-01;-500.00;Vermieter;Miete\n2026-11-02;-100.00;Eigenes Konto;Transfer",
      ],
      [b.id, "2026-11-03;100.00;Eigenes Konto;Transfer"],
    ] as const)
      await post("/api/import/confirm", {
        account_id,
        filename: "demo.csv",
        config,
        content_base64: Buffer.from(
          "Date;Amount;Party;Purpose\n" + rows,
        ).toString("base64"),
      });
    await post("/api/recurring-items", {
      name: "Miete",
      amount_cents: 50000,
      interval: "monthly",
      first_due_date: "2026-11-01",
      category_id: home,
      counterparty_hint: "Vermieter",
    });
    await post("/api/budgets", {
      month: "2026-11",
      amounts: [{ category_id: home, amount_cents: 60000 }],
    });
    const recurring = (
      await app.inject({ url: "/api/recurring?month=2026-11", headers })
    ).json();
    assert.equal(recurring.suggestions.length, 1);
    const match = recurring.suggestions[0];
    await post("/api/recurring/match", {
      occurrence_id: match.occurrence_id,
      transaction_id: match.transaction.id,
      confirm_category: true,
    });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/recurring/match",
          headers,
          payload: {
            occurrence_id: match.occurrence_id,
            transaction_id: match.transaction.id,
            confirm_category: true,
          },
        })
      ).statusCode,
      400,
    );
    const transfers = (
      await app.inject({ url: "/api/transfers", headers })
    ).json();
    assert.equal(transfers.suggestions.length, 1);
    const pair = transfers.suggestions[0];
    await post("/api/transfers", {
      outgoing_id: pair.outgoing.id,
      incoming_id: pair.incoming.id,
      category_id: transfer,
    });
    assert.equal(
      (await app.inject({ url: "/api/transfers", headers })).json().suggestions
        .length,
      0,
    );
    const dashboard = (
      await app.inject({ url: "/api/dashboard?month=2026-11", headers })
    ).json();
    assert.equal(dashboard.expense_cents, 50000);
    const housing = dashboard.categories.find(
      (c: { id: number }) => c.id === home,
    );
    assert.equal(housing.remaining_cents, 10000);
    assert.equal(housing.planned_cents, 0);
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/recurring/match/${match.occurrence_id}`,
          headers,
        })
      ).statusCode,
      200,
    );
    let restored = (await app.inject({ url: "/api/transactions", headers }))
      .json()
      .rows.find((row: { id: number }) => row.id === match.transaction.id);
    assert.equal(restored.category_id, null);
    assert.equal(restored.category_source, null);
    await post("/api/recurring/match", {
      occurrence_id: match.occurrence_id,
      transaction_id: match.transaction.id,
      confirm_category: false,
    });
    restored = (await app.inject({ url: "/api/transactions", headers }))
      .json()
      .rows.find((row: { id: number }) => row.id === match.transaction.id);
    assert.equal(restored.category_id, null);
    const pairId = (await app.inject({ url: "/api/transfers", headers })).json()
      .pairs[0].id;
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/transfers/${pairId}`,
          headers,
        })
      ).statusCode,
      200,
    );
    const unpaired = (await app.inject({ url: "/api/transactions", headers }))
      .json()
      .rows.filter((row: { id: number }) =>
        [pair.outgoing.id, pair.incoming.id].includes(row.id),
      );
    assert.deepEqual(
      unpaired.map((row: { category_id: number | null }) => row.category_id),
      [null, null],
    );
  } finally {
    await app.close();
  }
});

test("unused categories can be deleted without a replacement", async () => {
  const app = await createApp({ dbPath: ":memory:" });
  try {
    const auth = await app.inject("/api/auth");
    const setup = await app.inject({
      method: "POST",
      url: "/api/auth/setup",
      headers: {
        cookie: String(auth.headers["set-cookie"]).split(";")[0],
        "x-csrf-token": auth.json().csrf,
      },
      payload: { password: "ein-sicheres-passwort" },
    });
    const headers = {
      cookie: String(setup.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": setup.json().csrf,
    };
    const added = await app.inject({
      method: "POST",
      url: "/api/categories",
      headers,
      payload: { name: "Temporär" },
    });
    assert.equal(added.statusCode, 200);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/categories/${added.json().id}`,
      headers,
      payload: { replacement_id: null },
    });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(
      (await app.inject({ url: "/api/state", headers }))
        .json()
        .categories.some(
          (category: { name: string }) => category.name === "Temporär",
        ),
      false,
    );
  } finally {
    await app.close();
  }
});
