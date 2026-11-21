import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

test("server logs omit imported financial fields and credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "budget-privacy-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: {
      ...process.env,
      PORT: "4387",
      DB_PATH: join(dir, "test.sqlite"),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });
  const { promise: ready, resolve, reject } = Promise.withResolvers<void>();
  child.stdout.on("data", () => {
    if (logs.includes("Budget-App bereit")) resolve();
  });
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code !== 0) reject(new Error(`Serverstart fehlgeschlagen: ${code}`));
  });
  try {
    await ready;
    const origin = "http://127.0.0.1:4387";
    let cookie = "",
      csrf = "";
    const auth = await fetch(origin + "/api/auth");
    cookie = auth.headers.get("set-cookie")!.split(";")[0];
    csrf = ((await auth.json()) as { csrf: string }).csrf;
    const setup = await fetch(origin + "/api/auth/setup", {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: "PrivatePassword_unique_742" }),
    });
    assert.equal(setup.status, 200);
    cookie = setup.headers.get("set-cookie")!.split(";")[0];
    csrf = ((await setup.json()) as { csrf: string }).csrf;
    const post = async (path: string, data: object) =>
      fetch(origin + path, {
        method: "POST",
        headers: {
          cookie,
          "x-csrf-token": csrf,
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      });
    const account = await post("/api/accounts", {
      name: "PrivateAccount_742",
      type: "Giro",
    });
    const id = ((await account.json()) as { id: number }).id;
    const result = await post("/api/import/confirm", {
      account_id: id,
      filename: "PrivateFilename_742.csv",
      content_base64: Buffer.from(
        "Date;Amount;Party;Purpose\n2026-11-01;-742.19;PrivateParty_742;PrivatePurpose_742",
      ).toString("base64"),
      config: {
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
      },
    });
    assert.equal(result.status, 200);
    await fetch(origin + "/api/dashboard?month=2026-11", {
      headers: { cookie },
    });
    child.kill("SIGTERM");
    await once(child, "exit");
    for (const secret of [
      "PrivatePassword_unique_742",
      "PrivateAccount_742",
      "PrivateFilename_742",
      "PrivateParty_742",
      "PrivatePurpose_742",
      "74219",
    ])
      assert.equal(logs.includes(secret), false, `Log enthält ${secret}`);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
